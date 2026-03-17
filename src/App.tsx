import { StoreProvider, useStore } from '@/lib/store';
import DashboardPage from '@/pages/Dashboard';
import OnboardingPage from '@/pages/Onboarding';
import { AppHeader, ContentCard, PageLayout } from 'igloo-ui';
import * as React from 'react';

function Router() {
  const { route, isHydratingProfile } = useStore();
  React.useEffect(() => {
    document.body.dataset.appHydrating = isHydratingProfile ? 'true' : 'false';
    document.body.dataset.appRoute = isHydratingProfile ? 'hydrating' : route;
    return () => {
      delete document.body.dataset.appHydrating;
      delete document.body.dataset.appRoute;
    };
  }, [isHydratingProfile, route]);

  if (isHydratingProfile) {
    return (
      <PageLayout header={<AppHeader title="igloo-chrome" subtitle="browser signing device" />}>
        <ContentCard
          title="Restoring profile"
          description="Loading configured signer state from extension storage."
        />
      </PageLayout>
    );
  }
  if (route === 'onboarding') return <OnboardingPage />;
  return <DashboardPage />;
}

export default function App() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}
