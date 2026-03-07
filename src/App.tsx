import { StoreProvider, useStore } from '@/lib/store';
import DashboardPage from '@/pages/Dashboard';
import OnboardingPage from '@/pages/Onboarding';

function Router() {
  const { route } = useStore();
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
