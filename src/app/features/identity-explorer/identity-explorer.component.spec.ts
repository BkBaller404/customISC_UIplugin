import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SailpointPluginService } from '@core';
import { IdentityExplorerComponent } from './identity-explorer.component';

describe('IdentityExplorerComponent', () => {
  const mockGet = vi.fn();
  const mockPost = vi.fn();
  const mockApiReady = signal(true);
  const mockStatus = signal('ready');
  const mockContext = signal({ page: { route: 'https://acme.identitynow.com/ui/plugin/customuiplugin' } });
  let fixture: ComponentFixture<IdentityExplorerComponent>;
  let component: IdentityExplorerComponent;

  beforeEach(async () => {
    mockGet.mockReset().mockResolvedValue([]);
    mockPost.mockReset().mockResolvedValue({});
    mockApiReady.set(true);
    mockStatus.set('ready');

    await TestBed.configureTestingModule({
      imports: [IdentityExplorerComponent],
      providers: [
        { provide: SailpointPluginService, useValue: { apiReady: mockApiReady, status: mockStatus, context: mockContext, get: mockGet, post: mockPost, sdk: { api: { getToken: vi.fn().mockResolvedValue('token') } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityExplorerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('sends the documented Search POST v1 text query for identity search', async () => {
    mockPost.mockResolvedValue([{ id: 'identity-1', name: 'Ada Lovelace' }]);
    component['query'].set('Ada Lovelace');

    await component['search']();

    expect(mockPost).toHaveBeenCalledWith('/search/v1?limit=50', {
      indices: ['identities'],
      queryType: 'TEXT',
      textQuery: {
        terms: ['Ada Lovelace'],
        fields: ['displayName', 'firstName', 'lastName', 'email'],
        matchAny: false,
        contains: true,
      },
      sort: ['+displayName', '+id'],
      queryResultFilter: {
        includes: ['id', 'name', 'displayName', 'email', 'alias', 'status'],
      },
    });
    expect(component['results']().map(identity => identity.id)).toEqual(['identity-1']);
  });

  it('shows a connection message rather than silently ignoring search', async () => {
    mockApiReady.set(false);
    mockStatus.set('pending');
    component['query'].set('Ada');
    fixture.detectChanges();

    const searchButton = fixture.nativeElement.querySelector('button[type="button"]') as HTMLButtonElement;
    expect(searchButton.disabled).toBe(false);
    searchButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['error']()).toContain('still starting');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('still starting');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('asks for a query instead of silently returning on an empty search', async () => {
    await component['search']();

    expect(component['error']()).toContain('Enter a name');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('explains the Search API scope and user-level requirements on 403', async () => {
    mockPost.mockRejectedValue(Object.assign(new Error('API request failed.'), { status: 403 }));
    component['query'].set('Ada');

    await component['search']();

    expect(component['error']()).toContain('sp:search:read');
    expect(component['error']()).toContain('authorized user level');
  });

  it('loads a selected identity from the ISC identities v1 endpoint', async () => {
    mockGet.mockResolvedValue({ id: 'identity-1', name: 'Ada Lovelace', email: 'ada@example.com' });
    const identity = { id: 'identity-1', name: 'Ada Lovelace' };

    await component['openIdentity'](identity);

    expect(mockGet).toHaveBeenCalledWith('/identities/v1/identity-1');
    expect(component['selected']()?.email).toBe('ada@example.com');
  });

  it('renders ISC lifecycle state objects by state name', () => {
    expect(component['identityState']({
      id: 'identity-1',
      lifecycleState: { stateName: 'Active', manuallyUpdated: false },
    })).toBe('Active');
  });

  it('shows the graph link, action menu, and close-to-search control for a selected identity', () => {
    component['selected'].set({ id: 'identity-1', name: 'Ada Lovelace' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.graph-link')?.getAttribute('href'))
      .toBe('https://acme.identitynow.com/ui/identity-graph?entity=human_identity&id=identity-1');
    expect(fixture.nativeElement.querySelector('[aria-label="Exit to identity search"]')).toBeTruthy();

    fixture.nativeElement.querySelector('.actions__trigger').click();
    fixture.detectChanges();
    const menuText = fixture.nativeElement.querySelector('[role="menu"]')?.textContent ?? '';
    for (const action of ['Process Identity', 'Set User Levels', 'Delete Identity', 'Synchronize Attributes', 'Set Lifecycle State', 'Disable Identity', 'Reset Identity', 'Reset Password', 'Request Access', 'Certify Access', 'Validate User']) {
      expect(menuText).toContain(action);
    }
  });

  it('returns to the search view when the identity header is closed', () => {
    component['selected'].set({ id: 'identity-1', name: 'Ada Lovelace' });

    component['closeIdentity']();

    expect(component['selected']()).toBeNull();
    expect(component['accessDialogOpen']()).toBe(false);
  });

  it('submits a grant access request for the selected identity and chosen access item', async () => {
    component['selected'].set({ id: 'identity-1', name: 'Ada Lovelace' });
    component['selectedAccessItem'].set({ id: 'access-1', name: 'Payroll', type: 'ACCESS_PROFILE' });

    await component['submitAccessRequest']();

    expect(mockPost).toHaveBeenCalledWith('/access-requests/v1', {
      requestedFor: ['identity-1'],
      requestType: 'GRANT_ACCESS',
      requestedItems: [{ id: 'access-1', type: 'ACCESS_PROFILE' }],
    });
    expect(component['actionNotice']()).toContain('Access request submitted');
  });

  it('normalizes lowercase Search API access item types for access requests', () => {
    expect(component['normalizeAccessType']('accessprofile')).toBe('ACCESS_PROFILE');
    expect(component['normalizeAccessType']('role')).toBe('ROLE');
    expect(component['normalizeAccessType']('entitlement')).toBe('ENTITLEMENT');
  });

  it('loads source accounts through the UI Plugin SDK API client', async () => {
    component['selected'].set({ id: 'identity-1', name: 'Ada Lovelace' });

    await component['showTab']('accounts');

    expect(mockGet).toHaveBeenCalledWith(
      `/accounts/v1?${new URLSearchParams({ limit: '100', filters: 'identityId eq "identity-1"' })}`
    );
  });

  it('loads activity for the selected identity through the UI Plugin SDK API client', async () => {
    component['selected'].set({ id: 'identity-1', name: 'Ada Lovelace' });

    await component['showTab']('activity');

    expect(mockGet).toHaveBeenCalledWith(
      `/account-activities/v1?${new URLSearchParams({ 'regarding-identity': 'identity-1', limit: '25', sorters: '-created' })}`
    );
  });
});
