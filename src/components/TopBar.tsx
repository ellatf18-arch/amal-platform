import React from 'react';
import { LogOut, User } from 'lucide-react';
import type { AuthUser } from '../services/apiClient';
import { PWAInstallButton } from './PWAInstallButton';

export type AppView = 'platform' | 'onboarding' | 'dashboard' | 'storefront';

interface TopBarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onQuickStorefront: () => void;
  authUser?: AuthUser | null;
  onOpenAuth?: () => void;
  onLogout?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onNavigate,
  onQuickStorefront,
  authUser,
  onOpenAuth,
  onLogout,
}) => {
  const navItems: { id: AppView; label: string }[] = [
    { id: 'platform', label: 'Platform' },
    { id: 'onboarding', label: 'Onboarding' },
    { id: 'dashboard', label: 'Workspace' },
    { id: 'storefront', label: 'Live Storefront' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-neutral-200">
      <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('platform')}
          className="text-xl font-bold tracking-tight text-neutral-950 font-display whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F4C3A] rounded px-1"
        >
          AMAL
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-7" aria-label="Primary navigation">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 py-1 cursor-pointer border-b-2 ${
                  isActive
                    ? 'text-neutral-950 border-[#0F4C3A]'
                    : 'text-neutral-600 border-transparent hover:text-neutral-950 hover:border-neutral-300'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Install PWA + Auth status + primary action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton />
          {authUser ? (
            <button
              type="button"
              onClick={onLogout}
              title={`Signed in as ${authUser.email} — Click to sign out`}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-[#0F4C3A]" />
              <span className="hidden sm:inline max-w-[110px] truncate">
                {authUser.fullName.split(' ')[0]}
              </span>
              <LogOut className="w-3.5 h-3.5 text-neutral-500" />
            </button>
          ) : (
            onOpenAuth && (
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-white border border-neutral-300 rounded-lg hover:bg-neutral-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign In
              </button>
            )
          )}

          <button
            type="button"
            onClick={
              activeView === 'storefront'
                ? () => onNavigate('dashboard')
                : onQuickStorefront
            }
            className="px-4 py-2 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg hover:bg-[#0B3B2D] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {activeView === 'storefront' ? 'Back to Workspace' : 'Preview Live Site'}
          </button>
        </div>
      </div>

      {/* Mobile compact nav strip keeping aggregate sticky height minimal */}
      <div className="md:hidden border-t border-neutral-100 px-4 py-1.5 flex items-center justify-between gap-2 overflow-x-auto bg-white">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap shrink-0 ${
              activeView === item.id
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
};
