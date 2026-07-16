import { useEffect, useState } from 'react';
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
import RackResultsRoute from './pages/RackResultsRoute.jsx';
import { RackSwitchesRoute, RackNetworkRoute } from './pages/SideBySideRacks.jsx';
import RackTopologyRoute from './pages/RackTopologyRoute.jsx';
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
import ConnectionsPage from './pages/ConnectionsPage.jsx';
import MarketplacePage from './pages/MarketplacePage.jsx';
import MarketplaceNewPage from './pages/MarketplaceNewPage.jsx';
import OrgConsolePage from './pages/OrgConsolePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LogsPage from './pages/LogsPage.jsx';
import MultiRackNewPage from './pages/MultiRackNewPage.jsx';
import { ShutterProvider } from './ShutterContext.jsx';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { getPendingScan, clearPendingScan, fetchScanJob } from './utils/pendingScan';
import OnboardingTour from './components/OnboardingTour.jsx';
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

// NOTE: there used to be a ResumeToScan handler here that, on every native
// resume, bounced the user from /results back to /scan "to start fresh". In
// practice that threw away the scan they had just run: switch to another app,
// come back, and their results were gone. Leaving the WebView on whatever page
// the user was on is the correct behaviour — an in-flight scan is separately
// reclaimed by PendingScanResumer below.

// Reclaims a scan that was analyzing when the app got suspended. ScanPage left
// a marker (see utils/pendingScan); here we poll the server for that scan and,
// once it's done, drop the user straight on its results — instead of the empty
// upload screen they'd otherwise see. Runs on cold start (leftover marker) and
// on every native resume.
function PendingScanResumer() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;
    let sub = null;

    const tryResume = () => {
      const pending = getPendingScan();
      if (!pending || !isAuthed || resuming) return;
      setResuming(true);
      const deadline = Date.now() + 45000;
      const poll = async () => {
        if (cancelled) return;
        const job = await fetchScanJob(pending.id);
        if (cancelled) return;
        if (job.status === 'done' && job.rackId) {
          clearPendingScan(); setResuming(false);
          navigate(`/results/${encodeURIComponent(job.rackId)}`, { replace: true });
          return;
        }
        if (job.status === 'error' || job.status === 'missing') {
          clearPendingScan(); setResuming(false);
          return;   // fall back to whatever screen they're on (usually /scan)
        }
        if (Date.now() > deadline) { setResuming(false); return; }  // keep marker; let them retry
        pollTimer = setTimeout(poll, 1500);   // 'running' or transient error — keep waiting
      };
      poll();
    };

    tryResume();  // cold start with a leftover marker
    if (Capacitor.isNativePlatform()) {
      (async () => { sub = await CapApp.addListener('resume', () => tryResume()); })();
    }
    return () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer); sub?.remove?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  if (!resuming) return null;
  return (
    <div role="status" aria-live="polite" style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '18px', background: 'rgba(8,11,18,0.82)', backdropFilter: 'blur(6px)',
      color: '#eaf0fa', textAlign: 'center',
      padding: 'max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left))',
    }}>
      <div style={{
        width: '46px', height: '46px', borderRadius: '50%',
        border: '3px solid rgba(255,255,255,0.18)', borderTopColor: '#5fa0ff',
        animation: 'rtspin 0.8s linear infinite',
      }} />
      <div style={{ fontSize: '16px', fontWeight: 600 }}>Bringing your scan back&hellip;</div>
      <div style={{ fontSize: '13.5px', opacity: 0.7, maxWidth: '32ch' }}>
        We&rsquo;re finishing the analysis you started. This takes a moment.
      </div>
      <style>{`@keyframes rtspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ConnectionsProvider>
          <ShutterProvider>
            <AndroidBackHandler />
            <PendingScanResumer />
            <OnboardingTour />
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
            {/* Two-rack scan: pick 2 images (or a video) → detect both →
                combined topology with the uplinks that cross between racks.
                Static segment, so it out-ranks /multi-rack/:groupId. */}
            <Route path="/multi-rack/new" element={
              <ProtectedRoute><ResponsiveLayout><MultiRackNewPage /></ResponsiveLayout></ProtectedRoute>
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
            {/* Live operations dashboard — owner-gated on the server; the page
                itself shows a clear message if a non-owner reaches it. */}
            <Route path="/dashboard" element={
              <AdminRoute><ResponsiveLayout><DashboardPage /></ResponsiveLayout></AdminRoute>
            } />
            {/* Server log viewer — same admin gate as the ops dashboard. */}
            <Route path="/logs" element={
              <AdminRoute><ResponsiveLayout><LogsPage /></ResponsiveLayout></AdminRoute>
            } />
            <Route path="/connections" element={
              <AdminRoute><ResponsiveLayout><ConnectionsPage /></ResponsiveLayout></AdminRoute>
            } />
            {/* Integrations + Marketplace are organization-admin only. */}
            <Route path="/marketplace" element={
              <AdminRoute><ResponsiveLayout withBottomNav><MarketplacePage /></ResponsiveLayout></AdminRoute>
            } />
            <Route path="/marketplace/new" element={
              <AdminRoute><ResponsiveLayout withBottomNav><MarketplaceNewPage /></ResponsiveLayout></AdminRoute>
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
              <ProtectedRoute><ResponsiveLayout withBottomNav><RackSwitchesRoute /></ResponsiveLayout></ProtectedRoute>
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
              <ProtectedRoute><ResponsiveLayout><RackResultsRoute /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/results/:rackId/ports" element={
              <ProtectedRoute><ResponsiveLayout><PortsPage /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/results/:rackId/topology" element={
              <ProtectedRoute><ResponsiveLayout><RackTopologyRoute /></ResponsiveLayout></ProtectedRoute>
            } />
            <Route path="/results/:rackId/netdisco" element={
              <ProtectedRoute><ResponsiveLayout><RackNetworkRoute /></ResponsiveLayout></ProtectedRoute>
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
