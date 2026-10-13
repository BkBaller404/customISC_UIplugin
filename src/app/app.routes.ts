import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/identity-explorer/identity-explorer.component').then(m => m.IdentityExplorerComponent) },
  { path: '**', redirectTo: '' },
];
