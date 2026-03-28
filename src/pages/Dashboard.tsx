import * as React from 'react';
import { AppHeader, OperatorDashboardTabs, PageLayout } from 'igloo-ui';
import { PermissionsPanel } from '@/components/options/PermissionsPanel';
import { SettingsPanel } from '@/components/options/SettingsPanel';
import { SignerPanel } from '@/pages/Signer';
import { useStore } from '@/lib/store';
import { shortProfileId } from '@/lib/igloo';
import { Activity, ShieldCheck, Settings2 } from 'lucide-react';

type DashboardTab = 'signer' | 'permissions' | 'settings';

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
  const { profile, saveProfile, wipeAllData, logout } = useStore();
  const [activeTab, setActiveTab] = React.useState<DashboardTab>('signer');
  const profileTag = profile?.id ? `${profile.groupName ?? 'device'} (${shortProfileId(profile.id)})` : null;

  return (
    <PageLayout
      maxWidth="max-w-6xl"
      header={
        <AppHeader
          title="igloo-chrome"
          subtitle="operator dashboard"
          right={
            <div className="flex items-center gap-2">
              {profileTag ? (
                <div className="rounded-full border border-cyan-900/40 bg-cyan-950/30 px-3 py-1 text-xs uppercase tracking-wide text-cyan-200">
                  {profileTag}
                </div>
              ) : null}
              <div className="rounded-full border border-cyan-900/40 bg-cyan-950/30 px-3 py-1 text-xs uppercase tracking-wide text-cyan-200">
                extension operator console
              </div>
            </div>
          }
        />
      }
    >
      <OperatorDashboardTabs tabs={tabs} activeTab={activeTab} onChangeTab={setActiveTab} />

      {activeTab === 'signer' && (
        <div role="tabpanel" id="operator-panel-signer" aria-labelledby="operator-tab-signer">
          <SignerPanel embedded />
        </div>
      )}
      {activeTab === 'permissions' && (
        <div role="tabpanel" id="operator-panel-permissions" aria-labelledby="operator-tab-permissions">
          <PermissionsPanel />
        </div>
      )}
      {activeTab === 'settings' && (
        <div role="tabpanel" id="operator-panel-settings" aria-labelledby="operator-tab-settings">
          <SettingsPanel
            profile={profile}
            saveProfile={saveProfile}
            logout={logout}
            wipeAllData={wipeAllData}
          />
        </div>
      )}
    </PageLayout>
  );
}
