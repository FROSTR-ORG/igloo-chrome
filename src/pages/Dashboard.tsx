import * as React from 'react';
import { AppHeader } from '@/components/ui/app-header';
import { PageLayout } from '@/components/ui/page-layout';
import { RuntimePanel } from '@/components/options/RuntimePanel';
import { PermissionsPanel } from '@/components/options/PermissionsPanel';
import { SettingsPanel } from '@/components/options/SettingsPanel';
import { SignerPanel } from '@/pages/Signer';
import { useStore } from '@/lib/store';
import { Activity, ShieldCheck, SlidersHorizontal, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type DashboardTab = 'signer' | 'runtime' | 'permissions' | 'settings';

const tabs: Array<{
  key: DashboardTab;
  label: string;
  icon: React.ReactNode;
  description: string;
}> = [
  {
    key: 'signer',
    label: 'Signer',
    icon: <Activity className="h-4 w-4" />,
    description: 'runtime console'
  },
  {
    key: 'runtime',
    label: 'Runtime',
    icon: <SlidersHorizontal className="h-4 w-4" />,
    description: 'background + offscreen'
  },
  {
    key: 'permissions',
    label: 'Permissions',
    icon: <ShieldCheck className="h-4 w-4" />,
    description: 'site and peer policies'
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: <Settings2 className="h-4 w-4" />,
    description: 'operator controls'
  }
];

export default function DashboardPage() {
  const { profile, logout } = useStore();
  const [activeTab, setActiveTab] = React.useState<DashboardTab>('signer');

  return (
    <PageLayout
      maxWidth="max-w-6xl"
      header={
        <AppHeader
          title="igloo-chrome"
          subtitle="operator dashboard"
          right={
            <div className="rounded-full border border-cyan-900/40 bg-cyan-950/30 px-3 py-1 text-xs uppercase tracking-wide text-cyan-200">
              frost2x-style options surface
            </div>
          }
        />
      }
    >
      <section className="rounded-2xl border border-blue-900/30 bg-slate-950/60 p-3 shadow-2xl backdrop-blur-sm">
        <div className="grid gap-2 md:grid-cols-4">
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'rounded-xl border px-4 py-3 text-left transition-colors',
                  active
                    ? 'border-blue-500/40 bg-blue-500/15 text-blue-100'
                    : 'border-blue-900/20 bg-transparent text-gray-400 hover:border-blue-800/40 hover:bg-blue-950/20 hover:text-blue-200'
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {tab.icon}
                  {tab.label}
                </div>
                <div className="mt-1 text-xs uppercase tracking-wide opacity-80">{tab.description}</div>
              </button>
            );
          })}
        </div>
      </section>

      {activeTab === 'signer' && <SignerPanel embedded />}
      {activeTab === 'runtime' && <RuntimePanel />}
      {activeTab === 'permissions' && <PermissionsPanel />}
      {activeTab === 'settings' && <SettingsPanel profile={profile} onResetProfile={logout} />}
    </PageLayout>
  );
}
