import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import BottomNav from './components/BottomNav.jsx';
import DesktopShell from './components/DesktopShell.jsx';
import PointerGlow from './components/PointerGlow.jsx';
import { useIsDesktop } from './hooks/useIsDesktop';
import HomePage from './pages/HomePage.jsx';
import ScanPage from './pages/ScanPage.jsx';
import ResultsPage from './pages/ResultsPage.jsx';
import PortsPage from './pages/PortsPage.jsx';
import TopologyPage from './pages/TopologyPage.jsx';
import NetdiscoPage from './pages/NetdiscoPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import LogoCompare from './pages/LogoCompare.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import AcceptInvitePage from './pages/AcceptInvitePage.jsx';
import PendingApprovalPage from './pages/PendingApprovalPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import SpecificationsPage from './pages/SpecificationsPage.jsx';
import FirmwarePage from './pages/FirmwarePage.jsx';
import SwitchInformationPage from './pages/SwitchInformationPage.jsx';
import MultiRackTopologyPage from './pages/MultiRackTopologyPage.jsx';
import MultiRackRedirect from './pages/MultiRackRedirect.jsx';
import PortHistoryPage from './pages/PortHistoryPage.jsx';
import TenantMatPage from './pages/TenantMatPage.jsx';
import VRPage from './pages/VRPage.jsx';
import VRInspectPage from './pages/VRInspectPage.jsx';
import ConnectionsPage from './pages/ConnectionsPage.jsx';
import MarketplacePage from './pages/MarketplacePage.jsx';
import MarketplaceNewPage from './pages/MarketplaceNewPage.jsx';
import MarketplaceCheckoutPage from './pages/MarketplaceCheckoutPage.jsx';
import MarketplaceOrdersPage from './pages/MarketplaceOrdersPage.jsx';
import MarketplaceAlertsPage from './pages/MarketplaceAlertsPage.jsx';
import MarketplaceDashboardPage from './pages/MarketplaceDashboardPage.jsx';
import MarketplacePartnerAccountsPage from './pages/MarketplacePartnerAccountsPage.jsx';
import OrgConsolePage from './pages/OrgConsolePage.jsx';
import { ShutterProvider } from './ShutterContext.jsx';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { ConnectionsProvider } from './ConnectionsContext.jsx';
import { ThemeProvider } from './ThemeContext.jsx';

// Bounces unauthenticated visitors to /login, remembering where they were
// trying to go so we can send them back after login/signup.
// True when the signed-in user's organization is NOT active — pending owner
// approval, rejected, or deactivated. Owners have no org and are never gated.
// Such users are held on the /pending screen (which explains the exact state)
// instead of being let into an app they can't actually use.
function orgNotActive(user) {
  const s = user?.organization?.status;
  return user?.role !== 'owner' && !!s && s !== 'active';
}

function ProtectedRoute({ children }) {
  const { isAuthed, user } = useAuth();
  const location = useLocation();
  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (orgNotActive(user)) {
    return <Navigate to="/pending" replace />;
  }
  return children;
}

// Integrations + Marketplace are organization-admin features (only the admin
// manages connected systems and sells surplus gear). Everyone else is sent home.
function AdminRoute({ children }) {
  const { isAuthed, user } = useAuth();
  const location = useLocation();
  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (orgNotActive(user)) {
    return <Navigate to="/pending" replace />;
  }
  if (user?.role !== 'org_admin' && user?.role !== 'owner') {
    return <Navigate to="/" replace />;
  }
  return children;
}

// The /pending waiting screen: only for a signed-in user whose org is pending.
// If they're not authed -> login; if their org is already active -> into the app.
function PendingRoute({ children }) {
  const { isAuthed, user } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  if (!orgNotActive(user)) return <Navigate to="/scan" replace />;
  return children;
}

// Responsive layout wrapper — at ≥1024px viewports every page renders
// inside DesktopShell (sidebar + topbar + full-width main canvas).
// Below the breakpoint the page renders bare, exactly as the mobile
// build does today — so the mobile experience is untouched.
function ResponsiveLayout({ children, withBottomNav = false }) {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return <DesktopShell>{children}</DesktopShell>;
  }
  return <>{children}{withBottomNav && <BottomNav />}</>;
}


// Bridges Android's hardware back button to React Router. Without this, the
// system back closes the WebView activity (kicks user to launcher) instead of
// walking the SPA history. Root pages exit the app explicitly.
function AndroidBackHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let sub;
    (async () => {
      sub = await CapApp.addListener('backButton', () => {
        if (location.pathname === '/' || location.pathname === '/login') {
          CapApp.exitApp();
        } else {
          navigate(-1);
        }
      });
    })();
    return () => { sub?.remove?.(); };
  }, [navigate, location.pathname]);
  return null;
}

// On reopening the app, the WebView keeps the last page it was on — which can
// be a finished scan's Overview. Rather than drop the user back into a stale
// past scan, send them to the Scan/upload screen to start fresh.
function ResumeToScan() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let sub;
    (async () => {
      sub = await CapApp.addListener('resume', () => {
        if (isAuthed && window.location.pathname.startsWith('/results')) {
          navigate('/scan', { replace: true });
        }
      });
    })();
    return () => { sub?.remove?.(); };
  }, [navigate, isAuthed]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ConnectionsProvider>
          <ShutterProvider>
            <AndroidBackHandler />
            <ResumeToScan />
            <PointerGlow />
            <Routes>
            {/* HomePage has its own desktop branch (HomeDesktop) via
                useIsDesktop, so DesktopShell is bypassed for "/" —
                otherwise we'd double-render the chrome. */}
            <Route path="/" element={<HomePage />} />
            <Route path="/login"  element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/invite/:code" element={<AcceptInvitePage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/pending" element={<PendingRoute><PendingApprovalPage /></PendingRoute>} />
            <Route path="/scan" element={
              <ProtectedRoute><ResponsiveLayout withBottomNav><ScanPage /></ResponsiveLayout></ProtectedRoute>
            } />
            {/* Legacy multi-rack landing → redirect to first member rack's
                Ports page (the rack-tabs strip there lets the user reach
                every other rack in the group + the combined 3D topology). */}
            <Route path="/multi-rack/:groupId" element={
              <ProtectedRoute><MultiRackRedirect /></ProtectedRoute>
            } />
            <Route path="/multi-rack/:groupId/topology" element={
              <ProtectedRoute><ResponsiveLayout><MultiRackTopologyPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/profile" element={
              <ProtectedRoute><ResponsiveLayout withBottomNav><ProfilePage /></ResponsiveLayout></ProtectedRoute>
            } />
            {/* Organization console — owner (platform) + org_admin manage
                Organizations → Sites → Members. Full-page (no app chrome). */}
            <Route path="/organizations" element={
              <ProtectedRoute><OrgConsolePage /></ProtectedRoute>
            } />
            <Route path="/connections" element={
              <AdminRoute><ResponsiveLayout><ConnectionsPage /></ResponsiveLayout></AdminRoute>
            } />
            {/* Marketplace — restricted to Admin / Owner only. */}
            <Route path="/marketplace" element={
              <AdminRoute><ResponsiveLayout withBottomNav><MarketplacePage /></ResponsiveLayout></AdminRoute>
            } />
            <Route path="/marketplace/new" element={
              <AdminRoute><ResponsiveLayout withBottomNav><MarketplaceNewPage /></ResponsiveLayout></AdminRoute>
            } />
            <Route path="/marketplace/checkout/:listingId" element={
              <AdminRoute><ResponsiveLayout withBottomNav><MarketplaceCheckoutPage /></ResponsiveLayout></AdminRoute>
            } />
            <Route path="/marketplace/orders" element={
              <AdminRoute><ResponsiveLayout withBottomNav><MarketplaceOrdersPage /></ResponsiveLayout></AdminRoute>
            } />
            <Route path="/marketplace/orders/:orderId" element={
              <AdminRoute><ResponsiveLayout withBottomNav><MarketplaceOrdersPage /></ResponsiveLayout></AdminRoute>
            } />
            <Route path="/marketplace/alerts" element={
              <AdminRoute><ResponsiveLayout withBottomNav><MarketplaceAlertsPage /></ResponsiveLayout></AdminRoute>
            } />
            <Route path="/marketplace/dashboard" element={
              <AdminRoute><ResponsiveLayout withBottomNav><MarketplaceDashboardPage /></ResponsiveLayout></AdminRoute>
            } />
            <Route path="/marketplace/partners" element={
              <AdminRoute><ResponsiveLayout withBottomNav><MarketplacePartnerAccountsPage /></ResponsiveLayout></AdminRoute>
            } />
            <Route path="/specifications" element={
              <ProtectedRoute><ResponsiveLayout withBottomNav><SpecificationsPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/firmware" element={
              <ProtectedRoute><ResponsiveLayout withBottomNav><FirmwarePage /></ResponsiveLayout></ProtectedRoute>
            } />
            {/* CMDB-driven switch list. /switch-info reads rackId from
                location.state; /switch-info/:rackId is the deep-link form. */}
            <Route path="/switch-info" element={
              <ProtectedRoute><ResponsiveLayout withBottomNav><SwitchInformationPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/switch-info/:rackId" element={
              <ProtectedRoute><ResponsiveLayout withBottomNav><SwitchInformationPage /></ResponsiveLayout></ProtectedRoute>
            } />
            {/* Old /history URLs redirect to the new combined profile page. */}
            <Route path="/history" element={<Navigate to="/profile" replace />} />
            <Route path="/results" element={
              <ProtectedRoute><ResponsiveLayout><ResultsPage /></ResponsiveLayout></ProtectedRoute>
            } />
            {/* Deep-linkable variant — when state.result is absent (cold link
                or rack-tab switch in a multi-rack scan), ResultsPage uses
                useParams + /api/scan/:rackId to populate itself. */}
            <Route path="/results/:rackId" element={
              <ProtectedRoute><ResponsiveLayout><ResultsPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/results/:rackId/ports" element={
              <ProtectedRoute><ResponsiveLayout><PortsPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/vr" element={
              <ProtectedRoute><ResponsiveLayout><VRPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/results/:rackId/vr" element={
              <ProtectedRoute><ResponsiveLayout><VRPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/results/:rackId/vr-inspect" element={
              <ProtectedRoute><ResponsiveLayout><VRInspectPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/results/:rackId/topology" element={
              <ProtectedRoute><ResponsiveLayout><TopologyPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/results/:rackId/netdisco" element={
              <ProtectedRoute><ResponsiveLayout><NetdiscoPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/port-history" element={
              <ProtectedRoute><ResponsiveLayout withBottomNav><PortHistoryPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/compare" element={<LogoCompare />} />
            {/* Demo: unified tenant rack-layout view. No auth — backed by
                server/data/demo_tenant.json, isolated from real scan data. */}
            <Route path="/demo/topology" element={<TenantMatPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ShutterProvider>
          </ConnectionsProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
