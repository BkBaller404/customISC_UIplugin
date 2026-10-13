import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SailpointPluginService } from '@core';
import type { AccountActivity } from '@sailpoint/angular-sdk/account_activities';
import type { Account } from '@sailpoint/angular-sdk/accounts';
interface IdentitySearchResult {
  id?: string;
  name?: string;
  displayName?: string;
  email?: string;
  alias?: string;
  status?: string;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AccessItem {
  id: string;
  name?: string;
  displayName?: string;
  type?: string;
}

interface IdentityRecord extends IdentitySearchResult {
  id: string;
  inactive?: boolean;
  lifecycleState?: string | { stateName?: string; name?: string; value?: string; manuallyUpdated?: boolean };
  cloudLifecycleState?: string | { stateName?: string; name?: string; value?: string; manuallyUpdated?: boolean };
}

type ViewTab = 'profile' | 'accounts' | 'activity';

@Component({
  selector: 'app-identity-explorer',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './identity-explorer.component.html',
  styleUrl: './identity-explorer.component.scss',
})
export class IdentityExplorerComponent {
  private readonly plugin = inject(SailpointPluginService);
  private readonly recentStorageKey = 'customuiplugin.recent-identities';

  protected readonly apiReady = this.plugin.apiReady;
  protected readonly pluginStatus = this.plugin.status;
  protected readonly query = signal('');
  protected readonly loading = signal(false);
  protected readonly detailLoading = signal(false);
  protected readonly panelLoading = signal(false);
  protected readonly error = signal('');
  protected readonly panelError = signal('');
  protected readonly hasSearched = signal(false);
  protected readonly results = signal<IdentityRecord[]>([]);
  protected readonly selected = signal<IdentityRecord | null>(null);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly activities = signal<AccountActivity[]>([]);
  protected readonly actionBusyId = signal<string | null>(null);
  protected readonly actionNotice = signal('');
  protected readonly actionsOpen = signal(false);
  protected readonly accessDialogOpen = signal(false);
  protected readonly accessQuery = signal('');
  protected readonly accessItems = signal<AccessItem[]>([]);
  protected readonly selectedAccessItem = signal<AccessItem | null>(null);
  protected readonly accessLoading = signal(false);
  protected readonly accessSubmitting = signal(false);
  protected readonly activeTab = signal<ViewTab>('profile');
  protected readonly recent = signal<IdentityRecord[]>(this.readRecent());
  protected readonly fields = computed(() => {
    const identity = this.selected();
    if (!identity) return [];
    const attributes = Array.isArray(identity.attributes)
      ? Object.fromEntries(identity.attributes.map((attribute) => [attribute.name || attribute.key || '', attribute.value]))
      : identity.attributes;
    const values = { ...attributes, ...identity };
    return Object.entries(values).filter(([key, value]) =>
      !['attributes', 'id', 'links', 'accounts'].includes(key) && value !== null && value !== undefined && typeof value !== 'object'
    );
  });

  protected async search(): Promise<void> {
    const term = this.query().trim();
    this.error.set('');
    if (!term) {
      this.error.set('Enter a name, email, or identity alias to search.');
      return;
    }
    if (!this.apiReady()) {
      this.error.set(this.pluginStatus() === 'pending'
        ? 'The ISC connection is still starting. Wait a moment, then search again.'
        : 'The ISC connection is not ready. Reopen this page using the URL returned by sail ui-plugins link.');
      return;
    }

    this.loading.set(true);
    this.hasSearched.set(true);
    this.selected.set(null);
    this.results.set([]);
    try {
      const response = await this.plugin.post<IdentitySearchResult[]>(
        `/search/v1?limit=50`,
        {
          indices: ['identities'],
          queryType: 'TEXT',
          textQuery: {
            terms: [term],
            fields: ['displayName', 'firstName', 'lastName', 'email'],
            matchAny: false,
            contains: true,
          },
          sort: ['+displayName', '+id'],
          queryResultFilter: {
            includes: ['id', 'name', 'displayName', 'email', 'alias', 'status'],
          },
        }
      );
      this.results.set(response.filter((identity) => identity.id) as IdentityRecord[]);
    } catch (err) {
      this.error.set(this.formatError(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async openIdentity(identity: IdentityRecord): Promise<void> {
    this.selected.set(identity);
    this.activeTab.set('profile');
    this.panelError.set('');
    this.accounts.set([]);
    this.activities.set([]);
    this.detailLoading.set(true);

    try {
      const detail = await this.plugin.get<IdentityRecord>(`/identities/v1/${encodeURIComponent(identity.id)}`);
      this.selected.set(detail);
      this.storeRecent(detail);
    } catch (err) {
      this.panelError.set(this.formatError(err));
      this.storeRecent(identity);
    } finally {
      this.detailLoading.set(false);
    }
  }

  protected closeIdentity(): void {
    this.selected.set(null);
    this.panelError.set('');
    this.actionNotice.set('');
    this.actionsOpen.set(false);
    this.accessDialogOpen.set(false);
  }

  protected identityGraphUrl(identity: IdentityRecord): string {
    const origin = this.plugin.context()?.page.route;
    if (!origin) return '#';
    return `${new URL(origin).origin}/ui/identity-graph?entity=human_identity&id=${encodeURIComponent(identity.id)}`;
  }

  protected async runIdentityAction(action: string): Promise<void> {
    const identity = this.selected();
    if (!identity) return;
    this.actionsOpen.set(false);
    this.actionNotice.set('');
    this.panelError.set('');

    if (action === 'Request Access') {
      this.accessDialogOpen.set(true);
      this.accessQuery.set('');
      this.accessItems.set([]);
      this.selectedAccessItem.set(null);
      return;
    }
    if (action === 'Certify Access' || action === 'Validate User') return;
    if (['Set User Levels', 'Delete Identity', 'Set Lifecycle State', 'Disable Identity', 'Reset Password'].includes(action)) {
      this.actionNotice.set(`${action} is not available from this plugin yet.`);
      return;
    }

    const confirmed = window.confirm(`${action} for ${this.displayName(identity)}?`);
    if (!confirmed) return;

    this.actionBusyId.set(identity.id);
    try {
      if (action === 'Process Identity') {
        await this.plugin.post('/identities/v1/process', { identityIds: [identity.id] });
      } else if (action === 'Synchronize Attributes') {
        await this.postExperimental(`/identities/v1/${encodeURIComponent(identity.id)}/synchronize-attributes`);
      } else if (action === 'Reset Identity') {
        await this.plugin.post(`/identities/v1/${encodeURIComponent(identity.id)}/reset`, {});
      }
      this.actionNotice.set(`${action} request submitted.`);
    } catch (err) {
      this.panelError.set(this.formatError(err));
    } finally {
      this.actionBusyId.set(null);
    }
  }

  protected async searchAccessItems(): Promise<void> {
    const term = this.accessQuery().trim();
    if (!term) {
      this.accessItems.set([]);
      return;
    }
    this.accessLoading.set(true);
    this.panelError.set('');
    try {
      const response = await this.plugin.post<AccessItem[]>('/search/v1?limit=25', {
        indices: ['accessprofiles', 'roles', 'entitlements'],
        queryType: 'TEXT',
        textQuery: {
          terms: [term],
          fields: ['name', 'displayName'],
          matchAny: true,
          contains: true,
        },
        queryResultFilter: { includes: ['id', 'name', 'displayName', 'type'] },
      });
      this.accessItems.set(response
        .map((item) => ({ ...item, type: this.normalizeAccessType(item.type) }))
        .filter((item) => item.id && item.type));
    } catch (err) {
      this.panelError.set(this.formatError(err));
    } finally {
      this.accessLoading.set(false);
    }
  }

  protected async submitAccessRequest(): Promise<void> {
    const identity = this.selected();
    const item = this.selectedAccessItem();
    if (!identity || !item || !item.type) return;
    this.accessSubmitting.set(true);
    this.panelError.set('');
    try {
      await this.plugin.post('/access-requests/v1', {
        requestedFor: [identity.id],
        requestType: 'GRANT_ACCESS',
        requestedItems: [{ id: item.id, type: item.type }],
      });
      this.accessDialogOpen.set(false);
      this.actionNotice.set(`Access request submitted for ${item.displayName || item.name || item.id}.`);
    } catch (err) {
      this.panelError.set(this.formatError(err));
    } finally {
      this.accessSubmitting.set(false);
    }
  }

  private async postExperimental(path: string): Promise<unknown> {
    const context = this.plugin.context();
    if (!context) throw new Error('ISC plugin context is not ready.');
    const token = await this.plugin.sdk.api.getToken();
    const response = await fetch(`${context.tenant.apiUrl.idn}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-SailPoint-Experimental': 'true',
      },
    });
    if (!response.ok) {
      throw Object.assign(new Error(`API request failed with status ${response.status} ${response.statusText}.`), { status: response.status });
    }
    return response.status === 204 ? undefined : response.json();
  }

  private normalizeAccessType(type?: string): string | undefined {
    switch (type?.toLowerCase()) {
      case 'accessprofile':
      case 'access_profile':
        return 'ACCESS_PROFILE';
      case 'role':
        return 'ROLE';
      case 'entitlement':
        return 'ENTITLEMENT';
      default:
        return undefined;
    }
  }

  protected async showTab(tab: ViewTab): Promise<void> {
    this.activeTab.set(tab);
    const identity = this.selected();
    if (!identity || tab === 'profile') return;

    this.panelLoading.set(true);
    this.panelError.set('');
    try {
      if (tab === 'accounts') {
        this.accounts.set(await this.plugin.get<Account[]>(`/accounts/v1?${new URLSearchParams({
          limit: '100',
          filters: `identityId eq "${identity.id}"`,
        })}`));
      } else {
        this.activities.set(await this.plugin.get<AccountActivity[]>(`/account-activities/v1?${new URLSearchParams({
          'regarding-identity': identity.id,
          limit: '25',
          sorters: '-created',
        })}`));
      }
    } catch (err) {
      this.panelError.set(this.formatError(err));
    } finally {
      this.panelLoading.set(false);
    }
  }

  protected async toggleAccount(account: Account): Promise<void> {
    if (!account.id || this.actionBusyId()) return;
    const operation = account.disabled ? 'enable' : 'disable';
    const label = account.name || account.nativeIdentity;
    if (!window.confirm(`${operation === 'disable' ? 'Disable' : 'Enable'} account ${label}?`)) return;

    this.actionBusyId.set(account.id);
    this.actionNotice.set('');
    this.panelError.set('');
    try {
      const accountPath = `/accounts/v1/${encodeURIComponent(account.id)}`;
      await this.plugin.post(`${accountPath}/${operation}`, {});
      this.actionNotice.set(`Account ${operation} request submitted.`);
      await this.showTab('accounts');
    } catch (err) {
      this.panelError.set(this.formatError(err));
    } finally {
      this.actionBusyId.set(null);
    }
  }

  protected displayName(identity: IdentityRecord): string {
    return identity.displayName || identity.name || identity.id;
  }

  protected identityState(identity: IdentityRecord): string {
    const lifecycleState = identity.cloudLifecycleState || identity.lifecycleState || identity.status;
    if (typeof lifecycleState === 'string') return lifecycleState;
    if (lifecycleState && typeof lifecycleState === 'object') {
      return lifecycleState.stateName || lifecycleState.name || lifecycleState.value || 'Status unavailable';
    }
    if (typeof identity.inactive === 'boolean') return identity.inactive ? 'Inactive' : 'Active';
    return 'Status unavailable';
  }

  protected async copy(value: unknown): Promise<void> {
    try {
      await navigator.clipboard.writeText(String(value ?? ''));
    } catch {
      this.panelError.set('Clipboard access is unavailable in this browser context.');
    }
  }

  private readRecent(): IdentityRecord[] {
    try {
      return JSON.parse(sessionStorage.getItem(this.recentStorageKey) ?? '[]') as IdentityRecord[];
    } catch {
      return [];
    }
  }

  private storeRecent(identity: IdentityRecord): void {
    const next = [identity, ...this.recent().filter((entry) => entry.id !== identity.id)].slice(0, 5);
    this.recent.set(next);
    sessionStorage.setItem(this.recentStorageKey, JSON.stringify(next));
  }

  private formatError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    const status = typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status: unknown }).status)
      : undefined;
    if (status === 403) {
      return 'ISC denied identity search. Search POST v1 requires the sp:search:read API scope and an authorized user level (Org Admin, Cert Admin, Report Admin, Source Admin/Subadmin, or Role Admin/Subadmin).';
    }
    if (status === 401) {
      return 'ISC rejected the plugin session. Reopen this page from the URL returned by sail ui-plugins link and sign in again.';
    }
    if (message.includes('SP_GET_CURRENT_TOKEN_RES')) {
      return 'ISC did not return a refreshed session token. Reopen the plugin using the URL returned by sail ui-plugins link. If this continues, confirm the plugin is being served from the linked customuiplugin project and reload the ISC page.';
    }
    return status ? `${message} (HTTP ${status})` : message;
  }
}
