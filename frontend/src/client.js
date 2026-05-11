const { useEffect, useMemo, useState } = React;
const h = React.createElement;
const config = window.__AETNIX_CONFIG__ ?? window.__NORTON_CONFIG__ ?? { apiBaseUrl: 'http://localhost:4000/api' };
const storageKey = 'aetnix-session';
const defaultBrand = {
  name: 'AETNIX',
  product: 'Aetnix Command',
  shell: 'Aetnix Operations Shell',
  eyebrow: 'Aetnix // MSP + Ops',
  authLabel: 'Aetnix control plane',
  supportLabel: 'MSP command center',
  sidebarFooter: 'Operate customers, assets, projects, and tickets from one sharp shell.',
  headerLogoUrl: '',
  headerImageUrl: '',
  theme: 'ember',
  accentColor: '',
};
const routes = [
  { label: 'Dashboard', href: '/dashboard', key: 'dashboard' },
  { label: 'Customers', href: '/customers', key: 'customers' },
  { label: 'Assets', href: '/assets', key: 'assets' },
  { label: 'Monitoring', href: '/monitoring', key: 'monitoring' },
  { label: 'Alerts', href: '/alerts', key: 'alerts' },
  { label: 'Projects', href: '/projects', key: 'projects' },
  { label: 'Tickets', href: '/tickets', key: 'tickets' },
  { label: 'Admin', href: '/admin', key: 'admin' },
];

function App() {
  const [route, setRoute] = useState(readRoute());
  const [session, setSession] = useState(readSession());
  const [bootStatus, setBootStatus] = useState({ loading: true, bootstrapped: true, platformAdminCount: 0 });
  const [validating, setValidating] = useState(Boolean(readSession()?.accessToken));
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    fetchJson('/v1/auth/bootstrap/status')
      .then((data) => setBootStatus({ loading: false, ...data }))
      .catch((error) => setBootStatus({ loading: false, bootstrapped: true, error: error.message }));
  }, []);

  useEffect(() => {
    if (!session?.accessToken) {
      setValidating(false);
      return;
    }
    setValidating(true);
    authFetch('/v1/auth/me', session.accessToken)
      .then((data) => {
        const next = {
          ...session,
          user: data.user,
          activeTenant: data.activeTenant,
          memberships: data.memberships,
          sessionMeta: data.session,
        };
        persistSession(next);
        setSession(next);
        if (window.location.pathname === '/login' || window.location.pathname === '/bootstrap') {
          navigate('/dashboard', setRoute);
        }
      })
      .catch(() => {
        const hadIdentity = Boolean(session?.user?.email || session?.activeTenant?.tenantKey || readHint('login-email') || readHint('login-tenant-key'));
        clearSession({ clearHints: true });
        setSession(null);
        setFlash({
          type: 'warning',
          message: hadIdentity ? 'Your session expired. Sign in again.' : 'Sign in to continue.',
        });
        navigate(bootStatus.bootstrapped ? '/login' : '/bootstrap', setRoute);
      })
      .finally(() => setValidating(false));
  }, [session?.accessToken, bootStatus.bootstrapped]);

  const auth = useMemo(() => ({
    session,
    setSession: (next) => {
      persistSession(next);
      setSession(next);
    },
    logout: async () => {
      try {
        if (session?.accessToken) {
          await authFetch('/v1/auth/logout', session.accessToken, { method: 'POST' });
        }
      } catch {}
      clearSession();
      setSession(null);
      setFlash({ type: 'info', message: 'Signed out.' });
      navigate(bootStatus.bootstrapped ? '/login' : '/bootstrap', setRoute);
    },
  }), [bootStatus.bootstrapped, session]);

  const bootstrapReady = bootStatus.bootstrapped || Boolean(session?.accessToken);

  if (bootStatus.loading || validating) {
    return h(FullscreenState, { title: 'Loading platform', message: session?.accessToken ? 'Finishing sign-in and restoring your workspace.' : 'Checking bootstrap state and restoring your session.' });
  }

  if (!bootstrapReady) {
    return h(BootstrapPage, {
      flash,
      onBootstrapped: (payload) => {
        setBootStatus((current) => ({ ...current, loading: false, bootstrapped: true, platformAdminCount: Math.max(current.platformAdminCount ?? 0, 1) }));
        handleNewSession(payload, auth, setFlash, setRoute, { welcomeMessage: 'Platform bootstrap complete. You are now signed in as the founding admin.' });
      },
      onAlreadyBootstrapped: (context) => {
        setBootStatus((current) => ({ ...current, loading: false, bootstrapped: true, platformAdminCount: Math.max(current.platformAdminCount ?? 0, 1) }));
        setFlash({ type: 'info', message: `Bootstrap was already completed${context?.adminEmail ? ` for ${context.adminEmail}` : ''}. Sign in to continue.` });
        navigate('/login', setRoute);
      },
    });
  }

  if (!session?.accessToken) {
    return h(LoginPage, {
      onLoggedIn: (payload) => handleNewSession(payload, auth, setFlash, setRoute),
      flash,
      defaultTenantKey: route.path === '/login' ? readHint('login-tenant-key') : '',
      defaultEmail: route.path === '/login' ? readHint('login-email') : '',
    });
  }

  return h(Shell, { route, setRoute, auth, flash, clearFlash: () => setFlash(null) });
}

function Shell({ route, setRoute, auth, flash, clearFlash }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [adminSettingsOpen, setAdminSettingsOpen] = useState(false);
  const isMobile = useViewport('(max-width: 960px)');
  const role = auth.session?.activeTenant?.role ?? auth.session?.user?.platformRole;
  const brand = getBrand(auth.session);
  const visibleRoutes = routes.filter((item) => {
    if (item.key === 'customers' && role === 'customer_user') return false;
    if (item.key === 'admin' && !hasRole(auth.session, ['platform_admin', 'msp_admin'])) return false;
    return true;
  });

  useEffect(() => {
    applyTheme(brand);
  }, [brand.theme, brand.accentColor, brand.headerImageUrl, brand.headerLogoUrl, brand.product, brand.name]);

  useEffect(() => {
    setMobileNavOpen(false);
    if (route.path !== '/admin') setAdminSettingsOpen(false);
  }, [route.path, route.search]);

  const content = renderRoute(route, auth, setRoute, {
    openAdminSettings: () => setAdminSettingsOpen(true),
    closeAdminSettings: () => setAdminSettingsOpen(false),
    adminSettingsOpen,
  });

  const sidebarNode = h('aside', { style: { ...styles.sidebar, ...(brand.headerImageUrl ? styles.sidebarWithImage : {}) } },
    brand.headerImageUrl ? h('div', { style: { ...styles.sidebarImage, backgroundImage: `linear-gradient(180deg, rgba(8,11,20,0.28) 0%, rgba(8,11,20,0.86) 55%, rgba(8,11,20,0.98) 100%), url(${brand.headerImageUrl})` } }) : null,
    h('div', { style: styles.sidebarInner },
      h('div', { style: styles.brandBlock },
        brand.headerLogoUrl ? h('img', { src: brand.headerLogoUrl, alt: `${brand.product} logo`, style: styles.brandLogo }) : h('div', { style: styles.brandMark }, brand.name.slice(0, 1)),
        h('div', { style: styles.brandEyebrow }, brand.eyebrow),
        h('h1', { style: styles.brandTitle }, brand.product),
        h('p', { style: styles.brandText }, auth.session?.activeTenant?.displayName ?? auth.session?.user?.email),
        h('p', { style: styles.brandText }, brand.sidebarFooter)
      ),
      h('nav', { style: styles.nav }, ...visibleRoutes.map((item) => navLink(item, route, setRoute))),
      h('div', { style: styles.sidebarFooter },
        h('div', { style: styles.userCard },
          h('strong', null, auth.session?.user?.fullName ?? auth.session?.user?.email),
          h('div', { style: styles.muted }, `${auth.session?.activeTenant?.role ?? auth.session?.user?.platformRole} · ${auth.session?.activeTenant?.tenantKey ?? 'platform'}`),
          h('div', { style: styles.muted }, `${auth.session?.memberships?.length ?? 0} membership(s)`)
        ),
        h('button', { style: styles.secondaryButton, onClick: auth.logout }, 'Sign out')
      )
    )
  );

  return h('div', { style: { ...styles.appShell, ...(isMobile ? styles.appShellMobile : {}) } },
    h('div', { style: { ...styles.mobileTopBar, ...(isMobile ? styles.mobileTopBarVisible : {}) } },
      h('button', { type: 'button', style: styles.iconButton, onClick: () => setMobileNavOpen((value) => !value), 'aria-label': mobileNavOpen ? 'Close navigation' : 'Open navigation' }, mobileNavOpen ? '✕' : '☰'),
      h('div', { style: styles.mobileTopBarBrand },
        brand.headerLogoUrl ? h('img', { src: brand.headerLogoUrl, alt: `${brand.product} logo`, style: styles.mobileTopBarLogo }) : h('div', { style: styles.mobileBrandMark }, brand.name.slice(0, 1)),
        h('div', { style: styles.mobileTopBarText },
          h('strong', null, brand.product),
          h('div', { style: styles.mobileTopBarSubtle }, auth.session?.activeTenant?.displayName ?? brand.supportLabel)
        )
      ),
      route.path === '/admin' ? h('button', { type: 'button', style: styles.iconButton, onClick: () => setAdminSettingsOpen(true), 'aria-label': 'Open admin settings' }, '⚙') : h('div', { style: styles.mobileTopBarSpacer })
    ),
    h('div', { style: { ...styles.mobileBackdrop, ...(isMobile ? styles.mobileBackdropActive : {}), ...(mobileNavOpen ? styles.mobileBackdropVisible : {}) }, onClick: () => setMobileNavOpen(false) }),
    h('div', { style: { ...styles.mobileSidebarWrap, ...(isMobile ? styles.mobileSidebarWrapActive : {}), ...(mobileNavOpen ? styles.mobileSidebarWrapOpen : {}) } }, sidebarNode),
    h('div', { style: { ...styles.desktopSidebarWrap, ...(isMobile ? styles.desktopSidebarWrapHidden : {}) } }, sidebarNode),
    h('main', { style: styles.main },
      flash ? h(AlertBanner, { flash, onClose: clearFlash }) : null,
      content
    )
  );
}

function renderRoute(route, auth, setRoute, shellState = {}) {
  if (route.path === '/' || route.path === '/dashboard') return h(DashboardPage, { auth, setRoute });
  if (route.path === '/customers') return h(CustomersPage, { auth, route, setRoute });
  if (route.path.startsWith('/customers/')) return h(CustomerDetailPage, { auth, route, setRoute });
  if (route.path === '/assets') return h(AssetsPage, { auth, route, setRoute });
  if (route.path.startsWith('/assets/')) return h(AssetDetailPage, { auth, route });
  if (route.path === '/monitoring') return h(MonitoringPage, { auth, route, setRoute });
  if (route.path.startsWith('/monitoring/')) return h(MonitoringDetailPage, { auth, route });
  if (route.path === '/alerts') return h(AlertsPage, { auth, route });
  if (route.path === '/projects') return h(ProjectsPage, { auth, route, setRoute });
  if (route.path.startsWith('/projects/')) return h(ProjectDetailPage, { auth, route });
  if (route.path === '/tickets') return h(TicketsPage, { auth, route, setRoute });
  if (route.path.startsWith('/tickets/')) return h(TicketDetailPage, { auth, route, setRoute });
  if (route.path === '/admin') return h(AdminPage, { auth, route, setRoute, ...shellState });
  return h(EmptyState, { title: 'Route not found', message: `No view is registered for ${route.path}.` });
}

function LoginPage({ onLoggedIn, flash, defaultTenantKey = '', defaultEmail = '' }) {
  const [form, setForm] = useState({ email: defaultEmail, password: '', tenantKey: defaultTenantKey });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = await fetchJson('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onLoggedIn(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return h(AuthLayout, { title: 'Sign in', subtitle: 'Real session-backed access for MSP operators and customer users.' },
    flash ? h(AlertBanner, { flash, onClose: () => {} }) : null,
    h('form', { style: styles.form, onSubmit: submit },
      field('Email', 'email', form.email, (value) => setForm({ ...form, email: value })),
      field('Password', 'password', form.password, (value) => setForm({ ...form, password: value })),
      field('Tenant key', 'text', form.tenantKey, (value) => setForm({ ...form, tenantKey: value }), 'Optional for single-tenant users; useful if the same email belongs to multiple tenants.'),
      error ? h('div', { style: styles.errorText }, error) : null,
      h('button', { style: styles.primaryButton, disabled: busy, type: 'submit' }, busy ? 'Signing in…' : 'Sign in')
    )
  );
}

function BootstrapPage({ onBootstrapped, onAlreadyBootstrapped, flash }) {
  const [form, setForm] = useState({ companyName: '', tenantKey: '', adminName: '', adminEmail: '', adminPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = await fetchJson('/v1/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      writeHint('login-email', form.adminEmail);
      writeHint('login-tenant-key', form.tenantKey);
      onBootstrapped(payload.session);
    } catch (err) {
      if (err.message === 'Platform bootstrap has already been completed') {
        writeHint('login-email', form.adminEmail);
        writeHint('login-tenant-key', form.tenantKey);
        onAlreadyBootstrapped?.({ adminEmail: form.adminEmail, tenantKey: form.tenantKey });
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return h(AuthLayout, { title: 'Bootstrap platform', subtitle: 'First-run setup creates the MSP tenant and the platform admin in one pass.' },
    flash ? h(AlertBanner, { flash, onClose: () => {} }) : null,
    h('form', { style: styles.form, onSubmit: submit },
      field('MSP company name', 'text', form.companyName, (value) => setForm({ ...form, companyName: value })),
      field('Tenant key', 'text', form.tenantKey, (value) => setForm({ ...form, tenantKey: value })),
      field('Admin name', 'text', form.adminName, (value) => setForm({ ...form, adminName: value })),
      field('Admin email', 'email', form.adminEmail, (value) => setForm({ ...form, adminEmail: value })),
      field('Admin password', 'password', form.adminPassword, (value) => setForm({ ...form, adminPassword: value }), 'Use the same credentials you will use to sign in after setup.'),
      error ? h('div', { style: styles.errorText }, error) : null,
      h('button', { style: styles.primaryButton, disabled: busy, type: 'submit' }, busy ? 'Creating platform…' : 'Bootstrap platform')
    )
  );
}

function DashboardPage({ auth, setRoute }) {
  return h(DataScreen, {
    title: 'Dashboard',
    subtitle: 'Fleet health, tenant load, open alerts, and project throughput in one shell.',
    requests: {
      me: '/v1/auth/me',
      customers: '/v1/customers/dashboard',
      assets: '/v1/monitoring/assets',
      alerts: '/v1/monitoring/alerts',
      projects: '/v1/projects',
      tickets: '/v1/tickets',
    },
    auth,
    render: ({ me, customers, assets, alerts, projects, tickets }) => {
      const assetRows = assets.assets ?? [];
      const alertRows = alerts.alerts ?? [];
      const projectRows = projects.projects ?? [];
      const ticketRows = tickets.tickets ?? [];
      const customerRows = customers.dashboard ?? [];
      const openCritical = alertRows.filter((item) => item.state === 'open' && item.severity === 'critical').length;
      const offline = assetRows.filter((item) => item.status === 'offline').length;
      const warning = assetRows.filter((item) => item.status === 'warning').length;
      const openTickets = ticketRows.filter((item) => !['resolved', 'closed'].includes(item.status)).length;

      return h('div', null,
        h(StatsGrid, {
          items: [
            { label: 'Active tenant', value: me.activeTenant?.displayName ?? 'Platform scope', tone: 'blue' },
            { label: 'Monitored assets', value: assetRows.length, tone: 'default' },
            { label: 'Critical alerts', value: openCritical, tone: openCritical ? 'red' : 'green' },
            { label: 'Warning / offline', value: `${warning} / ${offline}`, tone: offline ? 'red' : 'amber' },
            { label: 'Open tickets', value: openTickets, tone: openTickets ? 'amber' : 'green' },
          ],
        }),
        h(TwoColumn, {
          left: h(Panel, { title: 'Customer health' }, customerRows.length ? h('div', { style: styles.stack }, ...customerRows.slice(0, 6).map((row) =>
            h(RowLink, { key: row.customerTenantId, title: row.displayName, meta: `${row.assetCount} assets · ${row.siteCount} sites · ${row.offlineAssetCount} offline`, onClick: () => navigate(`/customers/${row.customerTenantId}`, setRoute) })
          )) : h(MutedCopy, null, 'No customer data yet.')),
          right: h(Panel, { title: 'Open alerts' }, alertRows.length ? h('div', { style: styles.stack }, ...alertRows.slice(0, 6).map((row) =>
            h(RowLink, { key: row.id, title: row.title, meta: `${row.severity} · ${row.state} · ${formatTime(row.lastObservedAt)}` })
          )) : h(MutedCopy, null, 'Alert queue is clear.')),
        }),
        h(Panel, { title: 'Current project load' }, projectRows.length ? h(SimpleTable, {
          columns: ['Name', 'Type', 'Status', 'Updated'],
          rows: projectRows.slice(0, 8).map((row) => [
            linkCell(row.name, () => navigate(`/projects/${row.id}`, setRoute)),
            row.projectType,
            badge(row.status),
            formatTime(row.updatedAt),
          ]),
        }) : h(MutedCopy, null, 'No projects yet.'))
      );
    },
  });
}

function CustomersPage({ auth, setRoute }) {
  const canCreate = hasRole(auth.session, ['platform_admin', 'msp_admin', 'project_manager']);
  return h(DataScreen, {
    title: 'Customers',
    subtitle: 'Tenant-aware customer directory with site and asset posture.',
    requests: { customers: '/v1/customers', dashboard: '/v1/customers/dashboard' },
    auth,
    actions: ({ refresh }) => canCreate ? [h(CreateCustomerForm, { key: 'create-customer', auth, onSuccess: refresh })] : [],
    render: ({ customers, dashboard }) => {
      const customerRows = customers.customers ?? [];
      const dashboardById = new Map((dashboard.dashboard ?? []).map((item) => [item.customerTenantId, item]));
      return h('div', { style: styles.cardGrid }, ...customerRows.map((customer) => {
        const summary = dashboardById.get(customer.id);
        return h(InfoCard, {
          key: customer.id,
          title: customer.displayName,
          subtitle: `${customer.tenantKey} · ${customer.status}`,
          items: [
            ['Assets', summary?.assetCount ?? 0],
            ['Sites', summary?.siteCount ?? 0],
            ['Offline', summary?.offlineAssetCount ?? 0],
            ['Latest health', formatTime(summary?.latestHealthAt)],
          ],
          onClick: () => navigate(`/customers/${customer.id}`, setRoute),
        });
      }));
    },
  });
}

function CustomerDetailPage({ auth, route }) {
  const customerId = route.path.split('/')[2];
  const canManage = hasRole(auth.session, ['platform_admin', 'msp_admin', 'project_manager']);
  return h(DataScreen, {
    title: 'Customer detail',
    subtitle: 'Sites, assets, and customer-specific health rolled into one view.',
    requests: { detail: `/v1/customers/${customerId}` },
    auth,
    actions: ({ refresh }) => canManage ? [
      h(CreateSiteForm, { key: 'create-site', auth, customerId, onSuccess: refresh }),
      h(AddCustomerAdminForm, { key: 'add-customer-admin', auth, customerId, onSuccess: refresh }),
    ] : [],
    render: ({ detail }) => h('div', null,
      h(StatsGrid, { items: [
        { label: 'Customer', value: detail.customer?.displayName ?? 'Unknown' },
        { label: 'Sites', value: detail.sites?.length ?? 0 },
        { label: 'Assets', value: detail.assets?.length ?? 0 },
        { label: 'Members', value: detail.members?.length ?? 0 },
        { label: 'Offline', value: detail.dashboard?.offlineAssetCount ?? 0, tone: (detail.dashboard?.offlineAssetCount ?? 0) ? 'red' : 'green' },
      ] }),
      h(TwoColumn, {
        left: h(Panel, { title: 'Sites' }, (detail.sites ?? []).length ? h('div', { style: styles.stack }, ...(detail.sites ?? []).map((site) => h(RowLink, { key: site.id, title: site.name, meta: [site.city, site.stateRegion, site.countryCode].filter(Boolean).join(', ') || 'No location data' }))) : h(MutedCopy, null, 'No sites created yet.')),
        right: h('div', { style: styles.stack },
          h(Panel, { title: 'Customer admins' }, (detail.members ?? []).length ? h('div', { style: styles.stack }, ...(detail.members ?? []).map((member) => h(RowLink, { key: member.id, title: member.fullName || member.email, meta: `${member.email} · ${member.role}` }))) : h(MutedCopy, null, 'No customer users added yet.')),
          h(Panel, { title: 'Assets' }, (detail.assets ?? []).length ? h('div', { style: styles.stack }, ...(detail.assets ?? []).map((asset) => h(RowLink, { key: asset.assetId, title: asset.assetName, meta: `${asset.assetType} · ${asset.status} · ${asset.primaryIp ?? 'no IP'}` }))) : h(MutedCopy, null, 'No customer assets yet.')),
        ),
      })
    ),
  });
}

function AssetsPage({ auth, setRoute }) {
  const canCreate = hasRole(auth.session, ['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer']);
  return h(DataScreen, {
    title: 'Assets',
    subtitle: 'Inventory with service relationships, health context, and deep detail routing.',
    requests: { assets: '/v1/assets', customers: '/v1/customers' },
    auth,
    actions: ({ refresh }) => canCreate ? [h(CreateAssetForm, { key: 'create-asset', auth, onSuccess: refresh })] : [],
    render: ({ assets }) => h(SimpleTable, {
      columns: ['Asset', 'Type', 'Status', 'IP', 'Last seen'],
      rows: (assets.assets ?? []).map((asset) => [
        linkCell(asset.assetName, () => navigate(`/assets/${asset.assetId}`, setRoute)),
        asset.assetType,
        badge(asset.status),
        asset.primaryIp ?? '—',
        formatTime(asset.lastSeenAt),
      ]),
    }),
  });
}

function AssetDetailPage({ auth, route }) {
  const assetId = route.path.split('/')[2];
  const canManage = hasRole(auth.session, ['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer']);
  return h(DataScreen, {
    title: 'Asset detail',
    subtitle: 'Inventory, health snapshots, relationship tracking, and first-pass agent enrollment in one operator view.',
    requests: { detail: `/v1/assets/${assetId}`, agent: `/v1/assets/${assetId}/agent` },
    auth,
    actions: ({ refresh, data }) => canManage ? [
      h(UpdateAssetForm, { key: 'update-asset', auth, assetId, asset: data?.detail?.asset, onSuccess: refresh }),
      h(CreateRelationshipForm, { key: 'create-relationship', auth, assetId, onSuccess: refresh }),
      h(GenerateAgentPackageForm, { key: 'generate-agent-package', auth, assetId, agent: data?.agent, onSuccess: refresh }),
    ] : [],
    render: ({ detail, agent }) => h('div', null,
      h(StatsGrid, { items: [
        { label: 'Asset', value: detail.asset?.assetName ?? 'Unknown' },
        { label: 'Status', value: detail.asset?.status ?? 'unknown', tone: severityTone(detail.asset?.status) },
        { label: 'IP', value: detail.asset?.primaryIp ?? 'n/a' },
        { label: 'Last seen', value: formatTime(detail.asset?.lastSeenAt) },
      ] }),
      h(TwoColumn, {
        left: h(Panel, { title: 'Health history' }, listOrEmpty((detail.healthHistory ?? []).map((snap) => `${formatTime(snap.observedAt)} · ${snap.status} · ${snap.summary ?? 'no summary'}`), 'No health snapshots yet.')),
        right: h(Panel, { title: 'Relationships' }, listOrEmpty((detail.relationships ?? []).map((rel) => `${rel.relationType} · ${rel.externalRef}${rel.label ? ` · ${rel.label}` : ''}`), 'No linked records yet.')),
      }),
      h(AgentEnrollmentCard, { agent }),
      h(TwoColumn, {
        left: h(Panel, { title: 'Site context' }, detail.site ? h('div', { style: styles.stack }, h('strong', null, detail.site.name), h(MutedCopy, null, [detail.site.city, detail.site.stateRegion, detail.site.countryCode].filter(Boolean).join(', '))) : h(MutedCopy, null, 'No site linked.')),
        right: h(Panel, { title: 'Asset summary' }, h('div', { style: styles.stack },
          h(MutedCopy, null, `${detail.asset?.assetType ?? 'asset'} · ${detail.asset?.hostname ?? 'no hostname'}`),
          h(MutedCopy, null, `Manufacturer ${detail.asset?.manufacturer ?? 'n/a'} · Model ${detail.asset?.model ?? 'n/a'}`),
          h(MutedCopy, null, `Serial ${detail.asset?.serialNumber ?? 'n/a'} · OS ${detail.asset?.operatingSystem ?? 'n/a'}`),
          h(MutedCopy, null, `Lifecycle ${detail.asset?.lifecycleState ?? 'n/a'} · Warranty ${formatTime(detail.asset?.warrantyExpiresAt)}`),
          h(MutedCopy, null, `CPU ${detail.asset?.cpuPercent ?? 'n/a'} · RAM ${detail.asset?.memoryPercent ?? 'n/a'} · Disk ${detail.asset?.diskPercent ?? 'n/a'}`),
          h(MutedCopy, null, detail.asset?.summary ?? 'No summary yet.')
        )),
      })
    ),
  });
}

function MonitoringPage({ auth, setRoute }) {
  return h(DataScreen, {
    title: 'Monitoring',
    subtitle: 'Operator view for live telemetry, alert pressure, and heartbeat freshness.',
    requests: { assets: '/v1/monitoring/assets' },
    auth,
    render: ({ assets }) => h(SimpleTable, {
      columns: ['Asset', 'Status', 'CPU / RAM / Disk', 'Alerts', 'Last seen'],
      rows: (assets.assets ?? []).map((asset) => [
        linkCell(asset.assetName, () => navigate(`/monitoring/${asset.assetId}`, setRoute)),
        badge(asset.status),
        `${value(asset.cpuPercent)} / ${value(asset.memoryPercent)} / ${value(asset.diskPercent)}`,
        String(asset.openAlertCount ?? 0),
        formatTime(asset.lastSeenAt),
      ]),
    }),
  });
}

function MonitoringDetailPage({ auth, route }) {
  const assetId = route.path.split('/')[2];
  return h(DataScreen, {
    title: 'Monitoring detail',
    subtitle: 'Telemetry history, software/service visibility, and alert feed for one endpoint.',
    requests: { detail: `/v1/monitoring/assets/${assetId}` },
    auth,
    render: ({ detail }) => h('div', null,
      h(StatsGrid, { items: [
        { label: 'Asset', value: detail.asset?.assetName ?? 'Unknown' },
        { label: 'Open alerts', value: detail.asset?.openAlertCount ?? 0, tone: (detail.asset?.openAlertCount ?? 0) ? 'red' : 'green' },
        { label: 'Patch status', value: detail.asset?.patchStatus ?? 'n/a' },
        { label: 'Agent', value: detail.asset?.registeredAgentVersion ?? 'n/a' },
      ] }),
      h(TwoColumn, {
        left: h(Panel, { title: 'Recent alerts' }, listOrEmpty((detail.alerts ?? []).map((item) => `${item.severity} · ${item.title} · ${item.state}`), 'No alerts for this asset.')),
        right: h(Panel, { title: 'Recent telemetry' }, listOrEmpty((detail.healthHistory ?? []).map((snap) => `${formatTime(snap.observedAt)} · CPU ${value(snap.cpuPercent)} · RAM ${value(snap.memoryPercent)} · Disk ${value(snap.diskPercent)}`), 'No telemetry yet.')),
      }),
      h(TwoColumn, {
        left: h(Panel, { title: 'Services' }, listOrEmpty((detail.asset?.services ?? []).slice(0, 20).map((service) => `${service.serviceName} · ${service.status}`), 'No service inventory yet.')),
        right: h(Panel, { title: 'Installed software' }, listOrEmpty((detail.asset?.installedSoftware ?? []).slice(0, 20).map((pkg) => `${pkg.packageName}${pkg.packageVersion ? ` · ${pkg.packageVersion}` : ''}`), 'No software inventory yet.')),
      })
    ),
  });
}

function AlertsPage({ auth }) {
  return h(DataScreen, {
    title: 'Alerts',
    subtitle: 'A clean queue for open and historical monitoring issues.',
    requests: { alerts: '/v1/monitoring/alerts' },
    auth,
    render: ({ alerts }) => h(SimpleTable, {
      columns: ['Severity', 'Title', 'State', 'Observed'],
      rows: (alerts.alerts ?? []).map((alert) => [badge(alert.severity), alert.title, badge(alert.state), formatTime(alert.lastObservedAt)]),
    }),
  });
}

function ProjectsPage({ auth, route, setRoute }) {
  const canCreate = hasRole(auth.session, ['platform_admin', 'msp_admin', 'project_manager']);
  const isMobile = useViewport('(max-width: 760px)');
  const view = route.query?.view ?? 'all';
  const projectType = view === 'service-board' ? 'service' : view === 'installation-board' ? 'installation' : view === 'internal' ? 'internal' : '';
  const requests = view === 'my-tasks'
    ? {
      jobs: `/v1/projects/jobs/queue?assigned=me${projectType ? `&projectType=${projectType}` : ''}`,
      catalog: '/v1/projects/meta/catalog',
    }
    : {
      projects: `/v1/projects${projectType ? `?projectType=${projectType}` : ''}`,
      catalog: '/v1/projects/meta/catalog',
    };
  return h(DataScreen, {
    title: 'Projects',
    subtitle: 'Service work, installation rollouts, internal initiatives, assigned tasks, and a practical board-first workflow.',
    requests,
    auth,
    actions: ({ refresh, data }) => [
      h(ProjectViewTabs, { key: 'project-tabs', view, setRoute, isMobile }),
      ...(canCreate ? [h(CreateProjectForm, { key: 'create-project', auth, catalog: data?.catalog?.catalog ?? [], setRoute, onSuccess: refresh })] : []),
    ],
    render: (data, { refresh }) => renderProjectsView(view, data?.projects?.projects ?? [], data?.catalog?.catalog ?? [], setRoute, refresh, data?.jobs?.jobs ?? [], isMobile),
  });
}

function ProjectViewTabs({ view, setRoute, isMobile = false }) {
  const tabs = [
    ['all', 'All Projects'],
    ['service-board', 'Service Board'],
    ['installation-board', 'Installation Board'],
    ['internal', 'Internal Projects'],
    ['my-tasks', 'My Tasks'],
    ['calendar', 'Calendar View'],
  ];
  return h('div', { style: { ...styles.tabRail, ...(isMobile ? styles.tabRailCompact : {}) } }, ...tabs.map(([key, label]) => h('button', {
    key,
    type: 'button',
    style: { ...styles.tabButton, ...(isMobile ? styles.tabButtonCompact : {}), ...(view === key ? styles.tabButtonActive : {}) },
    onClick: () => updateQuery({ view: key === 'all' ? null : key }, setRoute),
  }, label)));
}

function renderProjectsView(view, projects, catalog, setRoute, refresh, jobQueue = [], isMobile = false) {
  const serviceProfile = (catalog ?? []).find((item) => item.key === 'service');
  const installationProfile = (catalog ?? []).find((item) => item.key === 'installation');
  if (view === 'calendar') {
    const dated = projects.filter((project) => project.dueDate || project.nextDueAt).sort((a, b) => new Date(a.dueDate ?? a.nextDueAt) - new Date(b.dueDate ?? b.nextDueAt));
    return h(Panel, { title: 'Project calendar' }, dated.length ? h('div', { style: styles.stack }, ...dated.map((project) => h(RowLink, { key: project.id, title: project.name, meta: `${project.projectType} · due ${formatTime(project.dueDate ?? project.nextDueAt)} · ${project.customerName ?? 'Internal'}`, onClick: () => navigate(`/projects/${project.id}`, setRoute) }))) : h(MutedCopy, null, 'No dated project milestones yet.'));
  }

  if (view === 'my-tasks') {
    return h('div', { style: styles.stack },
      h(StatsGrid, { items: [
        { label: 'Assigned cards', value: jobQueue.length, tone: jobQueue.length ? 'amber' : 'green' },
        { label: 'Due today / overdue', value: jobQueue.filter((job) => job.dueAt && new Date(job.dueAt).getTime() < Date.now() + (1000 * 60 * 60 * 24)).length, tone: 'red' },
        { label: 'Service work', value: jobQueue.filter((job) => job.projectType === 'service').length, tone: 'blue' },
        { label: 'Installation work', value: jobQueue.filter((job) => job.projectType === 'installation').length, tone: 'blue' },
      ] }),
      isMobile
        ? h('div', { style: styles.compactList }, ...jobQueue.map((job) => h(InfoCard, {
          key: job.id,
          title: job.title,
          subtitle: `${job.projectName} · ${job.customerName ?? 'Internal'}`,
          items: [['Lane', job.boardColumnKey ?? '—'], ['Status', job.status ?? 'queued'], ['Due', formatTime(job.dueAt)]],
          onClick: () => navigate(`/projects/${job.projectId}`, setRoute),
          compact: true,
        })))
        : h(SimpleTable, {
          columns: ['Card', 'Project', 'Customer', 'Lane', 'Status', 'Due'],
          rows: jobQueue.map((job) => [job.title, linkCell(job.projectName, () => navigate(`/projects/${job.projectId}`, setRoute)), job.customerName ?? 'Internal', job.boardColumnKey ?? '—', badge(job.status), formatTime(job.dueAt)]),
        })
    );
  }

  if (view === 'service-board' || view === 'installation-board') {
    const profile = view === 'service-board' ? serviceProfile : installationProfile;
    const open = projects.reduce((sum, project) => sum + Number(project.openJobCount ?? 0), 0);
    const completed = projects.reduce((sum, project) => sum + Number(project.completedJobCount ?? 0), 0);
    const urgent = projects.filter((project) => ['urgent', 'high'].includes(project.priority)).length;
    return h('div', { style: styles.stack },
      profile ? h(Panel, { title: `${profile.label} dashboard` }, h('div', { style: styles.stack },
        h(MutedCopy, null, profile.description),
        h(StatsGrid, { items: [
          { label: `${profile.label} projects`, value: projects.length, tone: 'blue' },
          { label: 'Open cards', value: open, tone: open ? 'amber' : 'green' },
          { label: 'Completed cards', value: completed, tone: 'green' },
          { label: 'High / urgent projects', value: urgent, tone: urgent ? 'red' : 'blue' },
        ] }),
        h(TwoColumn, {
          left: h(Panel, { title: 'Default workflow' }, listOrEmpty((profile.boardColumns ?? []).map((column) => `${column.name}${column.wipLimit ? ` · WIP ${column.wipLimit}` : ''}`), 'No workflow profile.')),
          right: h(Panel, { title: 'Reports & templates' }, h('div', { style: styles.stack },
            ...(profile.reports ?? []).map((report) => h('div', { key: report.key, style: styles.rowLink }, h('strong', null, report.name), h('div', { style: styles.muted }, report.description))),
            ...(profile.templates ?? []).map((template) => h('div', { key: template.key, style: styles.rowLink }, h('strong', null, `Template: ${template.name}`), h('div', { style: styles.muted }, `${template.card?.title ?? 'No starter task'} · ${template.project?.priority ?? 'normal'} priority`)))
          )),
        })
      )) : null,
      h('div', { style: { ...styles.cardGrid, ...(isMobile ? styles.cardGridCompact : {}) } }, ...projects.map((project) => h(InfoCard, {
        key: project.id,
        title: project.name,
        subtitle: `${project.customerName ?? 'Internal'} · ${project.projectType} · ${project.status}`,
        items: [['Open cards', project.openJobCount ?? 0], ['Completed', project.completedJobCount ?? 0], ['Next due', formatTime(project.nextDueAt)], ['Owner', project.ownerName ?? 'Unassigned']],
        onClick: () => navigate(`/projects/${project.id}`, setRoute),
        compact: isMobile,
      })))
    );
  }

  if (isMobile) {
    return h('div', { style: styles.compactList }, ...projects.map((project) => h(InfoCard, {
      key: project.id,
      title: project.name,
      subtitle: `${project.customerName ?? 'Internal'} · ${project.projectType}`,
      items: [['Status', project.status ?? '—'], ['Priority', project.priority ?? 'normal'], ['Open cards', project.openJobCount ?? 0], ['Updated', formatTime(project.updatedAt)]],
      onClick: () => navigate(`/projects/${project.id}`, setRoute),
      compact: true,
    })));
  }

  return h(SimpleTable, {
    columns: ['Project', 'Customer', 'Type', 'Status', 'Priority', 'Open cards', 'Updated'],
    rows: projects.map((project) => [linkCell(project.name, () => navigate(`/projects/${project.id}`, setRoute)), project.customerName ?? 'Internal', project.projectType, badge(project.status), badge(project.priority ?? 'normal'), String(project.openJobCount ?? 0), formatTime(project.updatedAt)]),
  });
}

function ProjectDetailPage({ auth, route }) {
  const projectId = route.path.split('/')[2];
  const canManage = hasRole(auth.session, ['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer']);
  return h(DataScreen, {
    title: 'Project detail',
    subtitle: 'Board-first tracking with scoped cards, assignments, due dates, checklists, comments, attachments, labor, materials, and activity history.',
    requests: { workspace: `/v1/projects/${projectId}/workspace`, customers: '/v1/customers', assets: '/v1/assets', tickets: '/v1/tickets', me: '/v1/auth/me', tenants: '/v1/tenants' },
    auth,
    actions: ({ refresh, data }) => canManage ? [h(CreateProjectJobForm, { key: 'create-job', auth, projectId, workspace: data?.workspace, onSuccess: refresh })] : [],
    render: ({ workspace, assets, tickets }, { refresh }) => {
      const project = workspace.project;
      const jobs = workspace.jobs ?? [];
      const columns = workspace.columns ?? [];
      return h('div', null,
        h(StatsGrid, { items: [
          { label: 'Project', value: project?.name ?? 'Unknown' },
          { label: 'Type', value: project?.projectType ?? 'n/a' },
          { label: 'Status', value: project?.status ?? 'n/a', tone: severityTone(project?.status) },
          { label: 'Open cards', value: jobs.filter((job) => !['completed', 'cancelled'].includes(job.status)).length },
          { label: 'Customer / site', value: `${project?.customerName ?? 'Internal'}${project?.siteName ? ` · ${project.siteName}` : ''}` },
          { label: 'Due', value: formatTime(project?.dueDate ?? project?.nextDueAt) },
        ] }),
        h(TwoColumn, {
          left: h(Panel, { title: 'Summary' }, h('div', { style: styles.stack }, h(MutedCopy, null, project?.summary ?? 'No summary yet.'), h(MutedCopy, null, `Priority ${project?.priority ?? 'normal'} · Owner ${project?.ownerName ?? 'Unassigned'}`))),
          right: h(Panel, { title: 'Calendar slice' }, jobs.filter((job) => job.dueAt).length ? h('div', { style: styles.stack }, ...jobs.filter((job) => job.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)).slice(0, 8).map((job) => h(RowLink, { key: job.id, title: job.title, meta: `${job.boardColumnKey} · ${formatTime(job.dueAt)} · ${job.assignedUserName ?? 'Unassigned'}` }))) : h(MutedCopy, null, 'No dated cards yet.')),
        }),
        h(TwoColumn, {
          left: h(Panel, { title: `${workspace.profile?.label ?? project?.projectType} dashboard` }, h('div', { style: styles.stack },
            h(MutedCopy, null, workspace.profile?.description ?? 'No workflow description.'),
            h(StatsGrid, { items: [
              { label: 'Open cards', value: workspace.dashboard?.openJobs ?? 0, tone: (workspace.dashboard?.openJobs ?? 0) ? 'amber' : 'green' },
              { label: 'Overdue', value: workspace.dashboard?.overdueJobs ?? 0, tone: (workspace.dashboard?.overdueJobs ?? 0) ? 'red' : 'green' },
              { label: 'Due soon', value: workspace.dashboard?.dueSoonJobs ?? 0, tone: (workspace.dashboard?.dueSoonJobs ?? 0) ? 'amber' : 'blue' },
              { label: 'Unassigned', value: workspace.dashboard?.unassignedJobs ?? 0, tone: (workspace.dashboard?.unassignedJobs ?? 0) ? 'amber' : 'green' },
            ] }),
            listOrEmpty((workspace.dashboard?.byColumn ?? []).map((column) => `${column.name} · ${column.count} card(s)`), 'No cards on this board yet.')
          )),
          right: h(Panel, { title: 'Reports / permissions / templates' }, h('div', { style: styles.stack },
            ...(workspace.reports ?? []).map((report) => h('div', { key: report.key, style: styles.rowLink }, h('strong', null, report.name), h('div', { style: styles.muted }, report.summary), h('div', { style: styles.muted }, report.description))),
            workspace.permissions ? h('div', { style: styles.rowLink }, h('strong', null, 'Crew fit'), h('div', { style: styles.muted }, `Recommended hands: ${(workspace.permissions.recommendedCrew ?? []).join(', ') || 'project manager'}`), h('div', { style: styles.muted }, `Card updates ${workspace.permissions.canManageCards ? 'allowed' : 'limited'} for your role.`)) : null,
            ...(workspace.profile?.templates ?? []).map((template) => h('div', { key: template.key, style: styles.rowLink }, h('strong', null, `Starter: ${template.name}`), h('div', { style: styles.muted }, template.card?.title ?? 'No starter card'), h('div', { style: styles.muted }, template.card?.details ?? '')))
          )),
        }),
        h(ProjectBoard, { auth, projectId, project, columns, jobs, assets: assets.assets ?? [], tickets: tickets.tickets ?? [], canManage, profile: workspace.profile, refresh })
      );
    },
  });
}

function TicketsPage({ auth, route, setRoute }) {
  const canCreate = hasRole(auth.session, ['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer', 'customer_admin', 'customer_user']);
  const view = route.query?.view ?? 'all';
  const ticketQuery = view === 'my-queue'
    ? '?assigned=me'
    : view === 'unassigned'
      ? '?assigned=unassigned'
      : view === 'pending-customer'
        ? '?status=pending_customer'
        : view === 'resolved'
          ? '?status=resolved'
          : '';
  return h(DataScreen, {
    title: 'Tickets',
    subtitle: 'Customer portal and technician queue for incident intake, ownership, and lifecycle handling.',
    requests: { tickets: `/v1/tickets${ticketQuery}`, dashboard: '/v1/tickets/dashboard' },
    auth,
    actions: ({ refresh, data }) => [
      h(TicketViewTabs, { key: 'ticket-tabs', view, setRoute, dashboard: data?.dashboard }),
      ...(canCreate ? [h(CreateTicketForm, { key: 'create-ticket', auth, onSuccess: refresh })] : []),
    ],
    render: ({ tickets, dashboard }) => h('div', { style: styles.stack },
      h(StatsGrid, { items: [
        { label: 'Open', value: dashboard?.counts?.open ?? 0, tone: (dashboard?.counts?.open ?? 0) ? 'amber' : 'green' },
        { label: 'Unassigned', value: dashboard?.counts?.unassigned ?? 0, tone: (dashboard?.counts?.unassigned ?? 0) ? 'red' : 'green' },
        { label: 'Pending customer', value: dashboard?.counts?.pending_customer ?? 0, tone: 'blue' },
        { label: 'Stale >24h', value: dashboard?.counts?.stale ?? 0, tone: (dashboard?.counts?.stale ?? 0) ? 'red' : 'green' },
      ] }),
      h(SimpleTable, {
        columns: ['Ticket', 'Customer', 'Status', 'Priority', 'Assigned', 'Replies', 'Updated'],
        rows: (tickets.tickets ?? []).map((ticket) => [
          linkCell(`#${ticket.ticketNumber} · ${ticket.subject}`, () => navigate(`/tickets/${ticket.id}`, setRoute)),
          ticket.customerName ?? '—',
          badge(ticket.status),
          badge(ticket.priority),
          ticket.assignedUserName ?? 'Unassigned',
          `${ticket.commentCount ?? 0} comment(s) · ${ticket.conversionCount ?? 0} conversion(s)`,
          formatTime(ticket.updatedAt),
        ]),
      })
    ),
  });
}

function TicketViewTabs({ view, setRoute, dashboard }) {
  const tabs = [
    ['all', `All (${dashboard?.counts?.total ?? 0})`],
    ['my-queue', `My queue (${dashboard?.counts?.assigned_to_me ?? 0})`],
    ['unassigned', `Unassigned (${dashboard?.counts?.unassigned ?? 0})`],
    ['pending-customer', `Pending customer (${dashboard?.counts?.pending_customer ?? 0})`],
    ['resolved', 'Resolved'],
  ];
  return h('div', { style: styles.tabRail }, ...tabs.map(([key, label]) => h('button', {
    key,
    type: 'button',
    style: { ...styles.tabButton, ...(view === key ? styles.tabButtonActive : {}) },
    onClick: () => updateQuery({ view: key === 'all' ? null : key }, setRoute),
  }, label)));
}

function TicketDetailPage({ auth, route }) {
  const ticketId = route.path.split('/')[2];
  const canManage = hasRole(auth.session, ['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer']);
  return h(DataScreen, {
    title: 'Ticket detail',
    subtitle: 'Threaded portal view with ownership, customer-visible updates, and conceptual conversion tracking.',
    requests: { detail: `/v1/tickets/${ticketId}` },
    auth,
    actions: ({ refresh, data }) => [
      h(AddTicketCommentForm, { key: 'comment', auth, ticketId, canManage, ticket: data?.detail?.ticket, onSuccess: refresh }),
      ...(canManage ? [h(UpdateTicketForm, { key: 'update-ticket', auth, ticketId, ticket: data?.detail?.ticket, onSuccess: refresh }), h(CreateTicketConversionForm, { key: 'create-conversion', auth, ticketId, onSuccess: refresh })] : []),
    ],
    render: ({ detail }) => h('div', null,
      h(StatsGrid, { items: [
        { label: 'Ticket', value: `#${detail.ticket?.ticketNumber ?? '—'}` },
        { label: 'Status', value: detail.ticket?.status ?? 'new', tone: severityTone(detail.ticket?.status) },
        { label: 'Priority', value: detail.ticket?.priority ?? 'normal', tone: severityTone(detail.ticket?.priority) },
        { label: 'Comments', value: detail.comments?.length ?? 0 },
      ] }),
      h(TwoColumn, {
        left: h(Panel, { title: 'Request' }, h('div', { style: styles.stack },
          h('strong', null, detail.ticket?.subject ?? 'Untitled ticket'),
          h(MutedCopy, null, detail.ticket?.description ?? 'No description.'),
          h(MutedCopy, null, `Customer: ${detail.ticket?.customerName ?? '—'} · Site: ${detail.ticket?.siteName ?? '—'} · Asset: ${detail.ticket?.assetName ?? '—'}`),
          h(MutedCopy, null, `Requester: ${detail.ticket?.requesterName ?? detail.ticket?.requesterEmail ?? 'Unknown'} · Assigned: ${detail.ticket?.assignedUserName ?? 'Unassigned'}`)
        )),
        right: h(Panel, { title: 'Lifecycle' }, h('div', { style: styles.stack },
          h(MutedCopy, null, `Created ${formatTime(detail.ticket?.createdAt)}`),
          h(MutedCopy, null, `Updated ${formatTime(detail.ticket?.updatedAt)}`),
          h(MutedCopy, null, `Last customer reply ${formatTime(detail.ticket?.lastCustomerReplyAt)}`),
          h(MutedCopy, null, `Last technician reply ${formatTime(detail.ticket?.lastTechnicianReplyAt)}`)
        )),
      }),
      h(TwoColumn, {
        left: h(Panel, { title: 'Conversation' }, (detail.comments ?? []).length ? h('div', { style: styles.stack }, ...(detail.comments ?? []).map((comment) => h('div', { key: comment.id, style: styles.rowLink },
          h('strong', null, `${comment.authorName ?? comment.authorEmail ?? 'Unknown'} · ${comment.authorRole ?? 'participant'}`),
          h('div', { style: styles.muted }, `${formatTime(comment.createdAt)}${comment.isCustomerVisible ? ' · customer visible' : ' · internal'}`),
          h('div', null, comment.body)
        ))) : h(MutedCopy, null, 'No conversation yet.')),
        right: h(Panel, { title: 'Conversions' }, (detail.conversions ?? []).length ? h(SimpleTable, {
          columns: ['Type', 'Status', 'Reference', 'Created'],
          rows: (detail.conversions ?? []).map((conversion) => [conversion.conversionType, badge(conversion.status), conversion.targetRef ?? 'Planned only', formatTime(conversion.createdAt)]),
        }) : h(MutedCopy, null, 'No downstream conversion records yet.')),
      })
    ),
  });
}

function AdminPage({ auth, openAdminSettings, adminSettingsOpen, closeAdminSettings }) {
  return h(DataScreen, {
    title: 'Admin & settings',
    subtitle: 'Operator controls, branding, member management, role visibility, and tenant-level defaults for service delivery and helpdesk flow.',
    requests: { overview: '/v1/admin/overview' },
    auth,
    actions: ({ refresh, data }) => {
      const overview = normalizeAdminOverview(data?.overview);
      if (!overview.operatorRoles.length) return [];
      return [
        h('button', { key: 'open-settings', type: 'button', style: styles.secondaryButton, onClick: () => openAdminSettings?.() }, '⚙ UI settings'),
        h(ChangePasswordForm, { key: 'change-password', auth }),
        h(CreateOperatorForm, { key: 'create-operator', auth, onSuccess: refresh, roles: overview.operatorRoles }),
      ];
    },
    render: ({ overview: rawOverview } = {}, { refresh }) => {
      const overview = normalizeAdminOverview(rawOverview);
      const members = overview.members;
      const customers = overview.customers;
      const roleSummaries = overview.roles;
      const operatorRoles = overview.operatorRoles;
      const projectCatalog = overview.projectCatalog;

      return h('div', { style: styles.stack },
        h(StatsGrid, { items: [
          { label: 'Operators', value: members.length, tone: 'blue' },
          { label: 'Customers', value: customers.length, tone: 'blue' },
          { label: 'Open tickets', value: overview.stats.ticketing.open, tone: 'amber' },
          { label: 'Open board cards', value: overview.stats.delivery.open_jobs, tone: 'amber' },
        ] }),
        h('div', { style: { ...styles.settingsDrawerBackdrop, ...(adminSettingsOpen ? styles.settingsDrawerBackdropVisible : {}) }, onClick: () => closeAdminSettings?.() }),
        h('aside', { style: { ...styles.settingsDrawer, ...(adminSettingsOpen ? styles.settingsDrawerOpen : {}) } },
          h('div', { style: styles.settingsDrawerHeader },
            h('div', null,
              h('div', { style: styles.kicker }, 'Admin shell settings'),
              h('h3', { style: styles.panelTitle }, 'Branding, theme & defaults')
            ),
            h('button', { type: 'button', style: styles.iconButton, onClick: () => closeAdminSettings?.(), 'aria-label': 'Close settings' }, '✕')
          ),
          h(AdminSettingsForm, { auth, settings: overview.tenant.settings, onSuccess: (result) => { refresh(); closeAdminSettings?.(); } })
        ),
        h(TwoColumn, {
          left: h('div', { style: styles.stack },
            h(Panel, { title: 'Role visibility' }, h(SimpleTable, {
              columns: ['Role', 'Permissions'],
              rows: roleSummaries.map((item) => [item.role, item.permissions.join(', ') || '—']),
            })),
            h(Panel, { title: 'Customer & workflow defaults' }, h('div', { style: styles.stack },
              h(MutedCopy, null, `Default project priority: ${overview.tenant.settings.platformDefaults.defaultProjectPriority}`),
              h(MutedCopy, null, `Service dispatch lane: ${overview.tenant.settings.serviceDefaults.defaultDispatchColumn}`),
              h(MutedCopy, null, `Helpdesk ticket priority: ${overview.tenant.settings.helpdeskDefaults.defaultTicketPriority}`),
              h(MutedCopy, null, `My work mode: ${overview.tenant.settings.workflowDefaults.myWorkMode}`),
              ...projectCatalog.map((profile) => h('div', { key: profile.key, style: styles.rowLink }, h('strong', null, profile.label), h('div', { style: styles.muted }, profile.description)))
            ))
          ),
          right: h(Panel, { title: 'Shell behavior' }, h('div', { style: styles.stack },
            h(MutedCopy, null, 'Brand changes apply live to the shell now, so the real sidebar/header is the preview.'),
            h(MutedCopy, null, 'Use the UI settings drawer to tune logo, header art, theme, and defaults without leaving Admin.'),
            h(MutedCopy, null, 'Best results: transparent PNG/SVG logos and wide header artwork with the subject near center.'),
          ))
        }),
        h(TwoColumn, {
          left: h(Panel, { title: 'Operators' }, h(SimpleTable, {
            columns: ['Name', 'Email', 'Role', 'Status', 'Last login'],
            rows: members.map((member) => [
              member.fullName || '—',
              member.email,
              h('div', { style: styles.stack }, renderCell(badge(member.role)), h(UpdateOperatorForm, { auth, member, roles: operatorRoles, onSuccess: refresh }), h(ResetOperatorPasswordForm, { auth, member })),
              badge(member.status),
              formatTime(member.lastLoginAt),
            ]),
          })),
          right: h(Panel, { title: 'Customers' }, customers.length ? h(SimpleTable, {
            columns: ['Customer', 'Tenant key', 'Status', 'Approved'],
            rows: customers.map((customer) => [customer.displayName, customer.tenantKey, badge(customer.status), formatTime(customer.approvedAt)]),
          }) : h(MutedCopy, null, 'No customer tenants yet.'))
        })
      );
    },
  });
}

function AdminSettingsForm({ auth, settings, onSuccess }) {
  const effective = settings ?? {};
  const [uploadError, setUploadError] = useState('');
  return h(InlineCreateForm, {
    title: 'Save branding & tenant defaults',
    fields: [
      { key: 'brandName', label: 'Brand name' },
      { key: 'product', label: 'Product title' },
      { key: 'shell', label: 'Shell label' },
      { key: 'eyebrow', label: 'Eyebrow / strapline' },
      { key: 'authLabel', label: 'Auth label' },
      { key: 'supportLabel', label: 'Support label' },
      { key: 'sidebarFooter', label: 'Sidebar support copy', type: 'textarea' },
      { key: 'theme', label: 'Theme skin', type: 'select', options: [['ember', 'Aetnix Ember'], ['obsidian', 'Obsidian Shell'], ['aurora', 'Aurora Signal']] },
      { key: 'accentColor', label: 'Custom accent hex', hint: 'Optional override like #ff6a3d or #7c3aed.' },
      { key: 'headerLogoUrl', label: 'Logo URL / uploaded asset', type: 'textarea', hint: 'Paste an HTTPS URL or upload an image below.' },
      { key: 'headerImageUrl', label: 'Header image URL / uploaded asset', type: 'textarea', hint: 'Optional shell artwork for the sidebar / preview card.' },
      { key: 'defaultProjectPriority', label: 'Default project priority', type: 'select', options: [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']] },
      { key: 'defaultTicketPriority', label: 'Default ticket priority', type: 'select', options: [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']] },
      { key: 'defaultDispatchColumn', label: 'Service dispatch lane' },
      { key: 'staleAfterHours', label: 'Stale threshold (hours)', type: 'number' },
      { key: 'myWorkMode', label: 'My work mode', type: 'select', options: [['assigned-only', 'Assigned only'], ['assigned-and-watching', 'Assigned + watching']] },
    ],
    defaults: {
      brandName: effective.branding?.brandName ?? defaultBrand.name,
      product: effective.branding?.product ?? defaultBrand.product,
      shell: effective.branding?.shell ?? defaultBrand.shell,
      eyebrow: effective.branding?.eyebrow ?? defaultBrand.eyebrow,
      authLabel: effective.branding?.authLabel ?? defaultBrand.authLabel,
      supportLabel: effective.branding?.supportLabel ?? defaultBrand.supportLabel,
      sidebarFooter: effective.branding?.sidebarFooter ?? defaultBrand.sidebarFooter,
      theme: effective.branding?.theme ?? defaultBrand.theme,
      accentColor: effective.branding?.accentColor ?? defaultBrand.accentColor,
      headerLogoUrl: effective.branding?.headerLogoUrl ?? '',
      headerImageUrl: effective.branding?.headerImageUrl ?? '',
      defaultProjectPriority: effective.platformDefaults?.defaultProjectPriority ?? 'normal',
      defaultTicketPriority: effective.helpdeskDefaults?.defaultTicketPriority ?? 'normal',
      defaultDispatchColumn: effective.serviceDefaults?.defaultDispatchColumn ?? 'dispatch',
      staleAfterHours: String(effective.helpdeskDefaults?.staleAfterHours ?? 24),
      myWorkMode: effective.workflowDefaults?.myWorkMode ?? 'assigned-only',
    },
    beforeFields: ({ form, updateForm }) => h('div', { style: styles.stack },
      h('div', { style: styles.uploadGrid },
        h(AssetUploadField, { label: 'Upload logo', value: form.headerLogoUrl, onChange: (value) => { setUploadError(''); updateForm((current) => ({ ...current, headerLogoUrl: value })); }, onError: setUploadError }),
        h(AssetUploadField, { label: 'Upload header image', value: form.headerImageUrl, onChange: (value) => { setUploadError(''); updateForm((current) => ({ ...current, headerImageUrl: value })); }, onError: setUploadError })
      ),
      uploadError ? h('div', { style: styles.errorText }, uploadError) : null,
      h('div', { style: styles.rowLink },
        h('strong', null, 'Live preview mode'),
        h('div', { style: styles.muted }, 'The shell updates immediately after save, so the sidebar and mobile top bar are now the source of truth.')
      )
    ),
    submitLabel: 'Save settings',
    busyLabel: 'Saving settings…',
    successMessage: 'Settings saved. Shell refresh applied.',
    transform: (payload) => ({
      branding: {
        brandName: sanitizeText(payload.brandName) || defaultBrand.name,
        product: sanitizeText(payload.product) || defaultBrand.product,
        shell: sanitizeText(payload.shell) || defaultBrand.shell,
        eyebrow: sanitizeText(payload.eyebrow) || defaultBrand.eyebrow,
        authLabel: sanitizeText(payload.authLabel) || defaultBrand.authLabel,
        supportLabel: sanitizeText(payload.supportLabel) || defaultBrand.supportLabel,
        sidebarFooter: sanitizeText(payload.sidebarFooter) || defaultBrand.sidebarFooter,
        theme: sanitizeTheme(payload.theme),
        accentColor: sanitizeHexColor(payload.accentColor),
        headerLogoUrl: sanitizeUrlOrDataUri(payload.headerLogoUrl),
        headerImageUrl: sanitizeUrlOrDataUri(payload.headerImageUrl),
      },
      platformDefaults: { defaultProjectPriority: payload.defaultProjectPriority },
      helpdeskDefaults: { defaultTicketPriority: payload.defaultTicketPriority, staleAfterHours: Number(payload.staleAfterHours ?? 24) },
      serviceDefaults: { defaultDispatchColumn: sanitizeText(payload.defaultDispatchColumn) || 'dispatch' },
      workflowDefaults: { myWorkMode: payload.myWorkMode || 'assigned-only' },
    }),
    onSuccess: (result) => {
      if (result?.settings) {
        auth.setSession({
          ...auth.session,
          activeTenant: { ...(auth.session?.activeTenant ?? {}), settings: result.settings },
          memberships: (auth.session?.memberships ?? []).map((membership) => membership.tenantId === auth.session?.activeTenant?.tenantId ? { ...membership, settings: result.settings } : membership),
        });
      }
      onSuccess?.(result);
    },
    onSubmit: (payload) => authFetch('/v1/admin/settings', auth.session.accessToken, { method: 'PATCH', body: JSON.stringify(payload) }),
  });
}

function AssetUploadField({ label, value, onChange, onError }) {
  const pickFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError?.('Only image uploads are supported right now.');
      event.target.value = '';
      return;
    }
    if (file.size > 1024 * 1024 * 2) {
      onError?.('Keep uploaded images under 2 MB for this first-pass inline asset flow.');
      event.target.value = '';
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onChange?.(dataUrl);
    } catch (error) {
      onError?.(error.message || 'Upload failed.');
    } finally {
      event.target.value = '';
    }
  };

  return h('label', { style: styles.inlineField },
    h('span', null, label),
    h('input', { type: 'file', accept: 'image/*', onChange: pickFile, style: styles.input }),
    value ? h('div', { style: styles.assetUploadPreview },
      h('img', { src: value, alt: `${label} preview`, style: styles.assetUploadImage }),
      h('button', { type: 'button', style: styles.ghostButton, onClick: () => onChange?.('') }, 'Clear')
    ) : h('span', { style: styles.fieldHint }, 'Stores as a data URI today so branding feels usable immediately.')
  );
}

function ChangePasswordForm({ auth }) {
  return h(InlineCreateForm, {
    title: 'Change password',
    fields: [
      { key: 'currentPassword', label: 'Current password', type: 'password', required: true },
      { key: 'newPassword', label: 'New password', type: 'password', required: true },
      { key: 'confirmPassword', label: 'Confirm new password', type: 'password', required: true },
    ],
    submitLabel: 'Update password',
    busyLabel: 'Updating password…',
    successMessage: 'Password changed. Sign in again with the new password.',
    transform: (payload) => {
      if (payload.newPassword !== payload.confirmPassword) throw new Error('New password and confirmation must match.');
      return {
        currentPassword: payload.currentPassword,
        newPassword: payload.newPassword,
        confirmPassword: payload.confirmPassword,
      };
    },
    onSuccess: async () => {
      clearSession({ clearHints: true });
      auth.setSession(null);
      window.location.href = '/login';
    },
    onSubmit: (payload) => authFetch('/v1/auth/account/password', auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) }),
  });
}

function CreateOperatorForm({ auth, onSuccess, roles = [] }) {
  return h(InlineCreateForm, {
    title: 'Add operator',
    fields: [
      { key: 'fullName', label: 'Full name', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'password', label: 'Temporary password', type: 'password', required: true },
      { key: 'role', label: 'Role', type: 'select', options: roles.map((item) => [item.role, item.role]), required: true },
    ],
    defaults: { role: roles[0]?.role ?? 'technician' },
    submitLabel: 'Create operator',
    onSuccess,
    onSubmit: (payload) => authFetch('/v1/admin/users', auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) }),
  });
}

function UpdateOperatorForm({ auth, member, roles = [], onSuccess }) {
  return h(InlineCreateForm, {
    title: 'Update',
    fields: [
      { key: 'role', label: 'Role', type: 'select', options: roles.map((item) => [item.role, item.role]) },
      { key: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['disabled', 'Disabled']] },
    ],
    defaults: { role: member.role, status: member.status ?? 'active' },
    submitLabel: 'Save',
    onSuccess,
    onSubmit: (payload) => authFetch(`/v1/admin/users/${member.userId}`, auth.session.accessToken, { method: 'PATCH', body: JSON.stringify(payload) }),
  });
}

function ResetOperatorPasswordForm({ auth, member }) {
  return h(InlineCreateForm, {
    title: 'Reset password',
    fields: [
      { key: 'password', label: 'Temporary password', type: 'password', required: true },
      { key: 'confirmPassword', label: 'Confirm temporary password', type: 'password', required: true },
    ],
    submitLabel: 'Reset',
    busyLabel: 'Resetting…',
    successMessage: 'Password reset. The user must sign in with the new password.',
    transform: (payload) => {
      if (payload.password !== payload.confirmPassword) throw new Error('Temporary password and confirmation must match.');
      return { password: payload.password };
    },
    onSubmit: (payload) => authFetch(`/v1/admin/users/${member.userId}/password`, auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) }),
  });
}

function DataScreen({ title, subtitle, requests, auth, render, actions = [] }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [reloadNonce, setReloadNonce] = useState(0);
  const reloadKey = useMemo(() => JSON.stringify(requests), [requests]);
  const refresh = () => setReloadNonce((value) => value + 1);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ loading: true, data: current.data, error: '' }));
    Promise.all(Object.entries(requests).map(async ([key, path]) => [key, await authFetch(path, auth.session.accessToken)]) )
      .then((entries) => {
        if (cancelled) return;
        setState({ loading: false, data: Object.fromEntries(entries), error: '' });
      })
      .catch((error) => {
        if (cancelled) return;
        setState((current) => ({ loading: false, data: current.data, error: error.message }));
      });
    return () => {
      cancelled = true;
    };
  }, [auth.session.accessToken, reloadKey, reloadNonce]);

  const hasData = state.data && typeof state.data === 'object';
  let resolvedActions = [];
  try {
    const nextActions = typeof actions === 'function' ? actions({ refresh, data: state.data }) : actions;
    resolvedActions = Array.isArray(nextActions) ? nextActions : [];
  } catch (error) {
    resolvedActions = [];
  }

  let renderedBody = null;
  if (hasData && !state.error) {
    try {
      renderedBody = render(state.data, { refresh });
    } catch (error) {
      renderedBody = h(Panel, { title: 'Render failed' }, h('div', { style: styles.errorText }, error.message));
    }
  }

  return h('section', { style: styles.pageSection },
    h(PageHeader, { title, subtitle }),
    resolvedActions.length ? h('div', { style: styles.actionBand }, h('div', { style: styles.actionRail }, ...resolvedActions)) : null,
    state.loading ? h(Panel, { title: 'Loading' }, h(MutedCopy, null, hasData ? 'Refreshing admin data without dropping the current view.' : 'Pulling fresh data from the API.')) : null,
    state.error ? h(Panel, { title: 'Load failed' }, h('div', { style: styles.errorText }, state.error)) : null,
    renderedBody,
    !state.loading && !state.error && !renderedBody ? h(Panel, { title: 'No data yet' }, h(MutedCopy, null, 'The admin surface is up, but the API returned an empty payload.')) : null
  );
}

function PageHeader({ title, subtitle }) {
  return h('div', { style: styles.pageHeader },
    h('div', { style: styles.pageHeaderBody }, h('p', { style: styles.kicker }, defaultBrand.shell), h('h2', { style: styles.pageTitle }, title), h('p', { style: styles.pageSubtitle }, subtitle))
  );
}

function CreateCustomerForm({ auth, onSuccess }) {
  const [form, setForm] = useState({ displayName: '', tenantKey: '' });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      const payload = buildCustomerCreatePayload(form);
      const result = await authFetch('/v1/tenants/customer', auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) });
      setForm({ displayName: '', tenantKey: '' });
      setStatus('Customer created. Add customer admins after creation from the customer detail view.');
      onSuccess?.(result);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  return h('form', { style: styles.inlineForm, onSubmit: submit },
    h('strong', { style: styles.formTitle }, 'New customer'),
    h('div', { style: styles.formFieldsGrid },
      h('label', { style: styles.inlineField },
        h('span', { style: styles.fieldText }, 'Customer name *'),
        h('input', {
          name: 'displayName',
          type: 'text',
          value: form.displayName,
          onChange: (e) => setForm((current) => ({ ...current, displayName: e.target.value })),
          style: styles.input,
          required: true,
        })
      ),
      h('label', { style: styles.inlineField },
        h('span', { style: styles.fieldText }, 'Tenant key *'),
        h('input', {
          name: 'tenantKey',
          type: 'text',
          value: form.tenantKey,
          onChange: (e) => setForm((current) => ({ ...current, tenantKey: e.target.value })),
          style: styles.input,
          required: true,
          pattern: '[a-z0-9-]+',
        }),
        h('span', { style: styles.fieldHint }, 'Lowercase key used for login scoping and URLs.')
      )
    ),
    h('div', { style: styles.formFooter },
      h('button', { type: 'submit', style: styles.secondaryButton, disabled: busy }, busy ? 'Saving…' : 'Create customer'),
      status ? h('div', { style: status.startsWith('Customer created') ? styles.okText : styles.errorText }, status) : null
    )
  );
}

function AddCustomerAdminForm({ auth, customerId, onSuccess }) {
  return h(InlineCreateForm, {
    title: 'Add customer admin',
    fields: [
      { key: 'fullName', label: 'Full name', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'password', label: 'Temporary password', type: 'password', required: true },
      { key: 'role', label: 'Role', type: 'select', options: [['customer_admin', 'Customer admin'], ['customer_user', 'Customer user']], required: true },
    ],
    defaults: { role: 'customer_admin' },
    submitLabel: 'Add admin',
    onSuccess,
    transform: buildCustomerAdminPayload,
    onSubmit: (payload) => authFetch(`/v1/tenants/${customerId}/members`, auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) }),
  });
}

function CreateSiteForm({ auth, customerId, onSuccess }) {
  return h(InlineCreateForm, {
    title: 'New site',
    fields: [
      { key: 'name', label: 'Site name', required: true },
      { key: 'siteCode', label: 'Code' },
      { key: 'city', label: 'City' },
      { key: 'stateRegion', label: 'State/region' },
      { key: 'countryCode', label: 'Country code' },
    ],
    submitLabel: 'Create site',
    onSuccess,
    transform: buildSiteCreatePayload,
    onSubmit: (payload) => authFetch(`/v1/customers/${customerId}/sites`, auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) }),
  });
}

function CreateAssetForm({ auth, onSuccess }) {
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({ customerTenantId: '', siteId: '', assetName: '', assetType: 'server', status: 'unknown', hostname: '', primaryIp: '', manufacturer: '', model: '', serialNumber: '', operatingSystem: '', warrantyExpiresAt: '', lifecycleState: 'active', notes: '' });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => { authFetch('/v1/customers', auth.session.accessToken).then((data) => setCustomers(data.customers ?? [])).catch(() => {}); }, [auth.session.accessToken]);

  const handleCustomerChange = (customerTenantId) => {
    setForm((current) => ({ ...current, customerTenantId, siteId: '' }));
    setSites([]);
    if (customerTenantId) {
      authFetch(`/v1/customers/${customerTenantId}/sites`, auth.session.accessToken)
        .then((data) => setSites(data.sites ?? []))
        .catch(() => setSites([]));
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      const payload = buildAssetCreatePayload(form);
      const result = await authFetch('/v1/assets', auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) });
      setForm({ customerTenantId: '', siteId: '', assetName: '', assetType: 'server', status: 'unknown', hostname: '', primaryIp: '', manufacturer: '', model: '', serialNumber: '', operatingSystem: '', warrantyExpiresAt: '', lifecycleState: 'active', notes: '' });
      setSites([]);
      setStatus('Saved. View refreshed.');
      onSuccess?.(result);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  return h('form', { style: styles.inlineForm, onSubmit: submit },
    h('strong', { style: styles.formTitle }, 'New asset'),
    h('div', { style: styles.formFieldsGrid },
    h('label', { style: styles.inlineField },
      h('span', null, 'Customer *'),
      h('select', { name: 'customerTenantId', value: form.customerTenantId, onChange: (e) => handleCustomerChange(e.target.value), style: styles.select, required: true },
        h('option', { value: '' }, 'Select customer'),
        ...customers.map((item) => h('option', { key: item.id, value: item.id }, item.displayName))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Site'),
      h('select', { name: 'siteId', value: form.siteId, onChange: (e) => setForm((current) => ({ ...current, siteId: e.target.value })), style: styles.select },
        h('option', { value: '' }, 'Select site'),
        ...sites.map((item) => h('option', { key: item.id, value: item.id }, item.name))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Asset name *'),
      h('input', { name: 'assetName', type: 'text', value: form.assetName, onChange: (e) => setForm((current) => ({ ...current, assetName: e.target.value })), style: styles.input, required: true })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Type *'),
      h('select', { name: 'assetType', value: form.assetType, onChange: (e) => setForm((current) => ({ ...current, assetType: e.target.value })), style: styles.select, required: true },
        ...[['server', 'Server'], ['workstation', 'Workstation'], ['network', 'Network'], ['printer', 'Printer'], ['mobile', 'Mobile'], ['vm', 'VM'], ['appliance', 'Appliance'], ['other', 'Other']].map(([value, label]) => h('option', { key: value, value }, label))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Initial status'),
      h('select', { name: 'status', value: form.status, onChange: (e) => setForm((current) => ({ ...current, status: e.target.value })), style: styles.select },
        ...[['unknown', 'Unknown'], ['online', 'Online'], ['warning', 'Warning'], ['critical', 'Critical'], ['offline', 'Offline']].map(([value, label]) => h('option', { key: value, value }, label))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Hostname'),
      h('input', { name: 'hostname', type: 'text', value: form.hostname, onChange: (e) => setForm((current) => ({ ...current, hostname: e.target.value })), style: styles.input })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Primary IP'),
      h('input', { name: 'primaryIp', type: 'text', value: form.primaryIp, onChange: (e) => setForm((current) => ({ ...current, primaryIp: e.target.value })), style: styles.input })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Manufacturer'),
      h('input', { name: 'manufacturer', type: 'text', value: form.manufacturer, onChange: (e) => setForm((current) => ({ ...current, manufacturer: e.target.value })), style: styles.input })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Model'),
      h('input', { name: 'model', type: 'text', value: form.model, onChange: (e) => setForm((current) => ({ ...current, model: e.target.value })), style: styles.input })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Serial number'),
      h('input', { name: 'serialNumber', type: 'text', value: form.serialNumber, onChange: (e) => setForm((current) => ({ ...current, serialNumber: e.target.value })), style: styles.input })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Operating system'),
      h('input', { name: 'operatingSystem', type: 'text', value: form.operatingSystem, onChange: (e) => setForm((current) => ({ ...current, operatingSystem: e.target.value })), style: styles.input })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Warranty expires'),
      h('input', { name: 'warrantyExpiresAt', type: 'date', value: form.warrantyExpiresAt, onChange: (e) => setForm((current) => ({ ...current, warrantyExpiresAt: e.target.value })), style: styles.input })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Lifecycle'),
      h('select', { name: 'lifecycleState', value: form.lifecycleState, onChange: (e) => setForm((current) => ({ ...current, lifecycleState: e.target.value })), style: styles.select },
        ...[['active', 'Active'], ['staged', 'Staged'], ['retired', 'Retired'], ['disposed', 'Disposed']].map(([value, label]) => h('option', { key: value, value }, label))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Notes'),
      h('textarea', { name: 'notes', value: form.notes, onChange: (e) => setForm((current) => ({ ...current, notes: e.target.value })), style: { ...styles.input, minHeight: 110 } })
    )),
    h('div', { style: styles.formFooter },
      h('button', { type: 'submit', style: styles.secondaryButton, disabled: busy }, busy ? 'Saving…' : 'Create asset'),
      status ? h('div', { style: status.startsWith('Saved') ? styles.okText : styles.errorText }, status) : null
    )
  );
}

function UpdateAssetForm({ auth, assetId, asset, onSuccess }) {
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState(() => createAssetEditorState(asset));

  useEffect(() => {
    setForm(createAssetEditorState(asset));
  }, [asset]);

  useEffect(() => {
    if (!asset?.customerTenantId) {
      setSites([]);
      return;
    }

    authFetch(`/v1/customers/${asset.customerTenantId}/sites`, auth.session.accessToken)
      .then((data) => setSites(data.sites ?? []))
      .catch(() => setSites([]));
  }, [auth.session.accessToken, asset?.customerTenantId]);

  return h(InlineCreateForm, {
    title: 'Update asset',
    fields: [
      { key: 'siteId', label: 'Site', type: 'select', options: sites.map((item) => [item.id, item.name]) },
      { key: 'assetName', label: 'Asset name', required: true },
      { key: 'assetType', label: 'Type', type: 'select', options: [['server', 'Server'], ['workstation', 'Workstation'], ['network', 'Network'], ['printer', 'Printer'], ['mobile', 'Mobile'], ['vm', 'VM'], ['appliance', 'Appliance'], ['other', 'Other']], required: true },
      { key: 'status', label: 'Status', type: 'select', options: [['unknown', 'Unknown'], ['online', 'Online'], ['warning', 'Warning'], ['critical', 'Critical'], ['offline', 'Offline']], required: true },
      ['hostname', 'Hostname'],
      ['primaryIp', 'Primary IP'],
      ['manufacturer', 'Manufacturer'],
      ['model', 'Model'],
      ['serialNumber', 'Serial number'],
      ['operatingSystem', 'Operating system'],
      { key: 'warrantyExpiresAt', label: 'Warranty expires', type: 'date' },
      { key: 'lifecycleState', label: 'Lifecycle', type: 'select', options: [['active', 'Active'], ['staged', 'Staged'], ['retired', 'Retired'], ['disposed', 'Disposed']], required: true },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    defaults: form,
    submitLabel: 'Save asset',
    transform: buildAssetUpdatePayload,
    onSuccess,
    onSubmit: (payload) => authFetch(`/v1/assets/${assetId}`, auth.session.accessToken, { method: 'PATCH', body: JSON.stringify(payload) }),
  });
}

function CreateRelationshipForm({ auth, assetId, onSuccess }) {
  return h(InlineCreateForm, {
    title: 'Link record',
    fields: [
      { key: 'relationType', label: 'Relation type', type: 'select', options: [['ticket', 'Ticket'], ['service_job', 'Service job'], ['installation_project', 'Installation project'], ['monitoring_alert', 'Monitoring alert']], required: true },
      ['externalRef', 'External reference'],
      ['label', 'Label'],
      ['metadataKey', 'Metadata key'],
      ['metadataValue', 'Metadata value'],
    ],
    defaults: { relationType: 'ticket' },
    submitLabel: 'Add relationship',
    onSuccess,
    transform: (payload) => {
      const metadataKey = sanitizeText(payload.metadataKey);
      const metadataValue = sanitizeText(payload.metadataValue);
      const next = { ...payload };
      delete next.metadataKey;
      delete next.metadataValue;
      if (metadataKey && metadataValue) next.metadata = { [metadataKey]: metadataValue };
      return next;
    },
    onSubmit: (payload) => authFetch(`/v1/assets/${assetId}/relationships`, auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) }),
  });
}

function GenerateAgentPackageForm({ auth, assetId, agent, onSuccess }) {
  const [result, setResult] = useState(null);
  const [uiStatus, setUiStatus] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const configJson = result ? JSON.stringify(result.package?.config ?? {}, null, 2) : '';
  const bootstrap = result?.package?.bootstrap ?? null;
  const bundleArtifact = result?.package?.artifacts?.find((artifact) => artifact.kind === 'bundle') ?? null;

  const handleCopy = async (label, value) => {
    try {
      await copyText(value);
      setUiStatus(`${label} copied.`);
    } catch (error) {
      setUiStatus(error.message);
    }
  };

  return h(InlineCreateForm, {
    title: 'Generate agent package',
    fields: [
      { key: 'platform', label: 'Platform', type: 'select', options: [['windows', 'Windows'], ['linux', 'Linux'], ['macos', 'macOS'], ['unknown', 'Generic']], required: true },
      { key: 'expiresInMinutes', label: 'Token lifetime (minutes)', type: 'number', hint: 'Default is 120 minutes.' },
      { key: 'label', label: 'Label', hint: 'Optional note like HQ laptop or lab VM.' },
    ],
    defaults: { platform: agent?.enrollments?.[0]?.platform ?? 'windows', expiresInMinutes: '120', label: '' },
    submitLabel: 'Generate package',
    busyLabel: 'Generating…',
    successMessage: 'Enrollment package generated.',
    transform: (payload) => ({
      platform: payload.platform,
      expiresInMinutes: Number(payload.expiresInMinutes ?? 120),
      label: sanitizeText(payload.label) || undefined,
    }),
    onSuccess: (payload) => {
      setResult(payload);
      setUiStatus('');
      setShowDetails(false);
      onSuccess?.(payload);
    },
    beforeFields: () => result ? h('div', { style: styles.generatedPackageCard },
      h('div', { style: styles.generatedPackageHeader },
        h('div', { style: styles.stack },
          h('strong', null, 'Package ready'),
          h('div', { style: styles.muted }, `${result.enrollment?.platform ?? 'unknown'} · ${result.enrollment?.packageKind ?? 'config'} · expires ${formatTime(result.enrollment?.expiresAt)}`)
        ),
        h('div', { style: styles.tagRail },
          h('span', { style: styles.badge }, result.enrollment?.status ?? 'ready'),
          result.package?.fileName ? h('span', { style: styles.badge }, result.package.fileName) : null
        )
      ),
      h('div', { style: styles.buttonRail },
        bundleArtifact ? h('button', { type: 'button', style: styles.primaryButton, onClick: () => downloadArtifact(bundleArtifact) }, 'Download bundle') : null,
        h('button', { type: 'button', style: styles.secondaryButton, onClick: () => downloadTextFile(result.package?.fileName || 'aetnix-agent-config.json', configJson, 'application/json') }, 'Download config'),
        bootstrap ? h('button', { type: 'button', style: styles.secondaryButton, onClick: () => downloadTextFile(bootstrap.fileName || 'install-aetnix-agent.sh', bootstrap.content, 'text/plain') }, 'Download bootstrap') : null,
        h('button', { type: 'button', style: styles.secondaryButton, onClick: () => handleCopy('Token', result.token || '') }, 'Copy token'),
        h('button', { type: 'button', style: styles.secondaryButton, onClick: () => setShowDetails((value) => !value) }, showDetails ? 'Hide contents' : 'Show contents')
      ),
      uiStatus ? h('div', { style: uiStatus.includes('copied') ? styles.okText : styles.errorText }, uiStatus) : null,
      showDetails ? h('div', { style: styles.stack },
        bundleArtifact ? h('div', { style: styles.rowLink }, h('strong', null, 'Bundle'), h('div', { style: styles.muted }, `${bundleArtifact.fileName} · ${bundleArtifact.entryCount ?? 0} file(s)`)) : null,
        h('div', { style: styles.rowLink }, h('strong', null, 'Token'), h('code', { style: styles.codeBlock }, result.token)),
        h('div', { style: styles.rowLink }, h('strong', null, 'Config JSON'), h('pre', { style: styles.codeBlock }, configJson)),
        bootstrap ? h('div', { style: styles.rowLink }, h('strong', null, bootstrap.fileName), h('pre', { style: styles.codeBlock }, bootstrap.content)) : null
      ) : null
    ) : null,
    onSubmit: (payload) => authFetch(`/v1/assets/${assetId}/agent-package`, auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) }),
  });
}

function AgentEnrollmentCard({ agent }) {
  const detail = agent ?? {};
  const registration = detail.agent;
  const latestEnrollment = detail.enrollments?.[0];
  const recentEnrollments = (detail.enrollments ?? []).slice(0, 3);
  return h(TwoColumn, {
    left: h(Panel, { title: 'Agent enrollment' }, h('div', { style: styles.stack },
      h(MutedCopy, null, latestEnrollment ? `Latest token ${latestEnrollment.status} · ${latestEnrollment.platform} · expires ${formatTime(latestEnrollment.expiresAt)}` : 'No enrollment package generated yet.'),
      h(MutedCopy, null, latestEnrollment?.tokenHint ? `Token hint: ${latestEnrollment.tokenHint}` : 'Generate a package from the asset toolbar.'),
      h(MutedCopy, null, latestEnrollment?.usedAt ? `Used ${formatTime(latestEnrollment.usedAt)} from ${latestEnrollment.usedByHostname ?? 'unknown host'}` : 'Token not used yet.'),
      recentEnrollments.length ? h('div', { style: styles.stack },
        h('strong', null, 'Recent enrollments'),
        ...recentEnrollments.map((entry) => h('div', { key: entry.id, style: styles.rowLink },
          h('div', { style: styles.splitRow },
            h('strong', null, `${entry.platform} · ${entry.packageKind}`),
            h('span', { style: styles.badge }, entry.status)
          ),
          h('div', { style: styles.muted }, `Hint ${entry.tokenHint ?? 'n/a'} · expires ${formatTime(entry.expiresAt)}`),
          h('div', { style: styles.muted }, entry.usedAt ? `Used ${formatTime(entry.usedAt)}` : 'Awaiting enrollment')
        ))
      ) : null
    )),
    right: h(Panel, { title: 'Agent identity & capabilities' }, registration ? h('div', { style: styles.stack },
      h(MutedCopy, null, `${registration.platform ?? 'unknown'} · ${registration.architecture ?? 'n/a'} · version ${registration.agentVersion ?? 'n/a'}`),
      h(MutedCopy, null, `Hostname ${registration.identity?.hostname ?? 'n/a'} · IP ${registration.identity?.primaryIp ?? 'n/a'}`),
      h(MutedCopy, null, `Collectors: ${(registration.capabilities?.supportedCollectors ?? []).join(', ') || 'n/a'}`),
      h(MutedCopy, null, `Actions: ${(registration.capabilities?.supportedActions ?? []).join(', ') || 'n/a'}`),
      h(MutedCopy, null, `Last seen ${formatTime(registration.lastSeenAt)}`)
    ) : h(MutedCopy, null, 'No enrolled agent yet.')),
  });
}

function ProjectBoard({ auth, projectId, project, columns, jobs, assets, tickets, canManage, profile, refresh }) {
  const [members, setMembers] = useState([]);
  const [sites, setSites] = useState([]);
  const isMobile = useViewport('(max-width: 760px)');
  useEffect(() => {
    authFetch(`/v1/tenants/${auth.session.activeTenant.tenantId}/members`, auth.session.accessToken).then((data) => setMembers(data.members ?? [])).catch(() => {});
    if (project?.customerTenantId) authFetch(`/v1/customers/${project.customerTenantId}/sites`, auth.session.accessToken).then((data) => setSites(data.sites ?? [])).catch(() => {});
  }, [auth.session.accessToken, auth.session.activeTenant.tenantId, project?.customerTenantId]);

  return h('div', { style: { ...styles.boardWrap, ...(isMobile ? styles.boardWrapMobile : {}) } }, ...columns.map((column) => {
    const columnJobs = jobs.filter((job) => job.boardColumnKey === column.columnKey);
    return h('section', { key: column.columnKey, style: { ...styles.boardColumn, ...(isMobile ? styles.boardColumnMobile : {}) } },
      h('div', { style: styles.boardColumnHeader }, h('strong', null, column.name), h('span', { style: styles.muted }, `${columnJobs.length} card(s)`)),
      ...columnJobs.map((job) => h(ProjectCard, { key: job.id, auth, projectId, project, job, columns, members, sites, assets, tickets, canManage, profile, refresh, isMobile }))
    );
  }));
}

function ProjectCard({ auth, projectId, project, job, columns, members, sites, assets, tickets, canManage, profile, refresh, isMobile = false }) {
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState({
    boardColumnKey: job.boardColumnKey ?? columns?.[0]?.columnKey ?? '',
    status: job.status ?? profile?.cardStatuses?.[0] ?? 'queued',
    assignedUserId: job.assignedUserId ?? '',
    dueAt: toDateTimeLocal(job.dueAt),
  });

  useEffect(() => {
    setEditor({
      boardColumnKey: job.boardColumnKey ?? columns?.[0]?.columnKey ?? '',
      status: job.status ?? profile?.cardStatuses?.[0] ?? 'queued',
      assignedUserId: job.assignedUserId ?? '',
      dueAt: toDateTimeLocal(job.dueAt),
    });
  }, [job.boardColumnKey, job.status, job.assignedUserId, job.dueAt, columns, profile?.cardStatuses]);

  const savePatch = async (patch) => {
    try {
      await authFetch(`/v1/projects/${projectId}/jobs/${job.id}`, auth.session.accessToken, { method: 'PATCH', body: JSON.stringify(patch) });
      refresh?.();
      setStatus('Saved. Board refreshed.');
    } catch (error) {
      setStatus(error.message);
    }
  };

  return h('div', { style: { ...styles.projectCard, ...(isMobile ? styles.projectCardCompact : {}) } },
    h('div', { style: styles.stack },
      h('strong', null, job.title),
      h('div', { style: styles.muted }, `${job.jobType} · ${job.status} · ${job.priority}`),
      h('div', { style: styles.muted }, job.details ?? 'No details yet.'),
      h('div', { style: styles.tagRail }, ...(job.labels ?? []).map((label, index) => h('span', { key: `${job.id}-label-${index}`, style: styles.badge }, label))),
      h('div', { style: styles.muted }, `Assignee: ${job.assignedUserName ?? 'Unassigned'} · Due: ${formatTime(job.dueAt)}`),
      h('div', { style: styles.muted }, `Customer/site: ${project.customerName ?? 'Internal'}${job.siteName ? ` · ${job.siteName}` : ''}`),
      h('div', { style: styles.muted }, `Related ticket: ${job.relatedTicketNumber ? `#${job.relatedTicketNumber} ${job.relatedTicketSubject ?? ''}` : '—'} · Asset: ${job.relatedAssetName ?? '—'}`),
      profile ? h('div', { style: styles.muted }, `Workflow: ${(profile.cardStatusLabels?.[job.status] ?? job.status)} · Board lanes tuned for ${profile.label.toLowerCase()} work`) : null,
      canManage ? h('div', { style: { ...styles.inlineField, ...(isMobile ? styles.inlineFieldCompact : {}) } },
        h('label', null, 'Move / assign / due'),
        h('select', { style: { ...styles.select, ...(isMobile ? styles.selectCompact : {}) }, value: editor.boardColumnKey, onChange: (e) => { const value = e.target.value; setEditor((current) => ({ ...current, boardColumnKey: value })); savePatch({ boardColumnKey: value }); } }, ...columns.map((column) => h('option', { key: column.columnKey, value: column.columnKey }, column.name))),
        h('select', { style: { ...styles.select, ...(isMobile ? styles.selectCompact : {}) }, value: editor.status, onChange: (e) => { const value = e.target.value; setEditor((current) => ({ ...current, status: value })); savePatch({ status: value }); } }, ...(profile?.cardStatuses ?? ['queued', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled']).map((item) => h('option', { key: item, value: item }, profile?.cardStatusLabels?.[item] ?? item))),
        h('select', { style: { ...styles.select, ...(isMobile ? styles.selectCompact : {}) }, value: editor.assignedUserId, onChange: (e) => { const value = e.target.value; setEditor((current) => ({ ...current, assignedUserId: value })); savePatch({ assignedUserId: value || null }); } }, h('option', { value: '' }, 'Unassigned'), ...members.map((member) => h('option', { key: member.userId, value: member.userId }, `${member.fullName} (${member.role})`))),
        h('input', { style: { ...styles.input, ...(isMobile ? styles.inputCompact : {}) }, type: 'datetime-local', value: editor.dueAt, onChange: (e) => setEditor((current) => ({ ...current, dueAt: e.target.value })), onBlur: (e) => savePatch({ dueAt: e.target.value ? new Date(e.target.value).toISOString() : null }) }),
      ) : null,
      h(TwoColumn, {
        left: h(Panel, { title: 'Checklist / comments' }, h('div', { style: styles.stack },
          ...(job.checklist ?? []).map((item) => h('label', { key: item.id ?? item.label, style: styles.rowLink }, h('input', { type: 'checkbox', checked: Boolean(item.done), onChange: () => savePatch({ checklist: (job.checklist ?? []).map((entry) => entry === item ? { ...entry, done: !entry.done } : entry) }) }), h('span', null, item.label))),
          canManage ? h(InlineCreateForm, { title: 'Add checklist item', fields: [{ key: 'label', label: 'Label', required: true }], submitLabel: 'Add item', onSubmit: (payload) => savePatch({ appendChecklistItem: payload }) }) : null,
          h(MutedCopy, null, `${(job.comments ?? []).length} comment(s)`),
          ...(job.comments ?? []).slice(-3).map((comment, index) => h('div', { key: `${job.id}-comment-${index}`, style: styles.rowLink }, h('strong', null, comment.userName ?? 'Operator'), h('div', { style: styles.muted }, `${comment.visibility ?? 'internal'} · ${formatTime(comment.at)}`), h('div', null, comment.body))),
          canManage ? h(InlineCreateForm, { title: 'Add comment', fields: [{ key: 'body', label: 'Comment', type: 'textarea', required: true }, { key: 'visibility', label: 'Visibility', type: 'select', options: [['internal', 'Internal'], ['customer_visible', 'Customer visible']] }], defaults: { visibility: 'internal' }, submitLabel: 'Post comment', onSubmit: (payload) => savePatch({ appendComment: payload }) }) : null
        )),
        right: h(Panel, { title: 'Attachments / labor / materials' }, h('div', { style: styles.stack },
          h(MutedCopy, null, `Attachments: ${(job.attachments ?? []).length} · Labor: ${(job.laborEntries ?? []).length} · Materials: ${(job.materialEntries ?? []).length}`),
          ...(job.attachments ?? []).slice(-2).map((item, index) => h('div', { key: `${job.id}-attachment-${index}`, style: styles.rowLink }, h('strong', null, item.name), h('div', { style: styles.muted }, item.url ?? 'No URL'))),
          canManage ? h(InlineCreateForm, { title: 'Add attachment', fields: [{ key: 'name', label: 'Name', required: true }, { key: 'url', label: 'URL', type: 'url' }], submitLabel: 'Attach', onSubmit: (payload) => savePatch({ appendAttachment: payload }) }) : null,
          canManage ? h(InlineCreateForm, { title: 'Log labor', fields: [{ key: 'summary', label: 'Summary', required: true }, { key: 'hours', label: 'Hours', type: 'number', required: true }], submitLabel: 'Log hours', onSubmit: (payload) => savePatch({ appendLaborEntry: payload }) }) : null,
          canManage ? h(InlineCreateForm, { title: 'Add material', fields: [{ key: 'name', label: 'Name', required: true }, { key: 'quantity', label: 'Quantity', type: 'number', required: true }, { key: 'cost', label: 'Cost', type: 'number' }], submitLabel: 'Add material', onSubmit: (payload) => savePatch({ appendMaterialEntry: payload }) }) : null
        ))
      }),
      h(Panel, { title: 'Activity' }, (job.activityHistory ?? []).length ? h('div', { style: styles.stack }, ...(job.activityHistory ?? []).slice(-6).reverse().map((item, index) => h('div', { key: `${job.id}-activity-${index}`, style: styles.rowLink }, h('strong', null, item.message), h('div', { style: styles.muted }, `${item.userName ?? 'Operator'} · ${formatTime(item.at)}`)))) : h(MutedCopy, null, 'No activity yet.')),
      status ? h('div', { style: status.startsWith('Saved') ? styles.okText : styles.errorText }, status) : null
    )
  );
}

function CreateProjectForm({ auth, catalog = [], setRoute, onSuccess }) {
  const [customers, setCustomers] = useState([]);
  const [selectedType, setSelectedType] = useState('service');
  const [form, setForm] = useState({ name: '', projectType: 'service', customerTenantId: '', templateKey: '', status: 'draft', priority: 'normal', startDate: '', dueDate: '', summary: '' });
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  useEffect(() => { authFetch('/v1/customers', auth.session.accessToken).then((data) => setCustomers(data.customers ?? [])).catch(() => {}); }, [auth.session.accessToken]);
  const projectProfiles = catalog.length ? catalog : [{ key: 'service', label: 'Service' }, { key: 'installation', label: 'Installation' }, { key: 'internal', label: 'Internal' }];
  const profile = projectProfiles.find((item) => item.key === selectedType) ?? projectProfiles.find((item) => item.key === 'service') ?? projectProfiles[0];
  const typeOptions = projectProfiles.map((item) => [item.key, item.label]);
  const statusOptions = (profile?.projectStatuses ?? ['draft', 'planned', 'active', 'approved', 'completed', 'archived']).map((item) => [item, profile?.projectStatusLabels?.[item] ?? item]);
  const templateOptions = [['', 'No template'], ...((profile?.templates ?? []).map((item) => [item.key, item.name]))];

  useEffect(() => {
    setForm((current) => ({
      ...current,
      projectType: selectedType,
      status: profile?.projectStatuses?.includes(current.status) ? current.status : (profile?.projectStatuses?.[0] ?? 'draft'),
      customerTenantId: selectedType === 'internal' ? '' : current.customerTenantId,
      templateKey: profile?.templates?.some((item) => item.key === current.templateKey) ? current.templateKey : '',
    }));
  }, [selectedType, profile?.key]);

  const handleTypeChange = (nextType) => {
    const resolvedType = nextType || 'service';
    setSelectedType(resolvedType);
    const nextProfile = projectProfiles.find((item) => item.key === resolvedType) ?? projectProfiles[0];
    setForm((current) => ({
      ...current,
      projectType: resolvedType,
      templateKey: '',
      status: nextProfile?.projectStatuses?.[0] ?? 'draft',
      customerTenantId: resolvedType === 'internal' ? '' : current.customerTenantId,
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatusMessage('');
    try {
      const payload = buildProjectCreatePayload(form, projectProfiles);
      const result = await authFetch('/v1/projects', auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) });
      setForm({ name: '', projectType: selectedType, customerTenantId: '', templateKey: '', status: profile?.projectStatuses?.[0] ?? 'draft', priority: 'normal', startDate: '', dueDate: '', summary: '' });
      setStatusMessage('Saved. View refreshed.');
      onSuccess?.(result);
      const projectId = result?.project?.id;
      if (projectId) navigate(`/projects/${projectId}`, setRoute);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return h('form', { style: styles.inlineForm, onSubmit: submit },
    h('strong', { style: styles.formTitle }, 'New project'),
    h('div', { style: styles.formFieldsGrid },
    h('label', { style: styles.inlineField },
      h('span', null, 'Project name *'),
      h('input', { name: 'name', type: 'text', value: form.name, onChange: (e) => setForm((current) => ({ ...current, name: e.target.value })), style: styles.input, required: true })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Project type *'),
      h('select', { name: 'projectType', value: form.projectType, onChange: (e) => handleTypeChange(e.target.value), style: styles.select, required: true },
        ...typeOptions.map(([value, label]) => h('option', { key: value, value }, label))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, selectedType !== 'internal' ? 'Customer *' : 'Customer'),
      h('select', { name: 'customerTenantId', value: form.customerTenantId, onChange: (e) => setForm((current) => ({ ...current, customerTenantId: e.target.value })), style: styles.select, required: selectedType !== 'internal', disabled: selectedType === 'internal' },
        h('option', { value: '' }, selectedType === 'internal' ? 'Internal project' : 'Select customer'),
        ...customers.map((item) => h('option', { key: item.id, value: item.id }, item.displayName))
      ),
      h('span', { style: styles.fieldHint }, selectedType === 'internal' ? 'Internal projects do not attach to a customer.' : '')
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Template'),
      h('select', { name: 'templateKey', value: form.templateKey, onChange: (e) => setForm((current) => ({ ...current, templateKey: e.target.value })), style: styles.select },
        ...templateOptions.map(([value, label]) => h('option', { key: value || 'empty-template', value }, label))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Status *'),
      h('select', { name: 'status', value: form.status, onChange: (e) => setForm((current) => ({ ...current, status: e.target.value })), style: styles.select, required: true },
        ...statusOptions.map(([value, label]) => h('option', { key: value, value }, label))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Priority *'),
      h('select', { name: 'priority', value: form.priority, onChange: (e) => setForm((current) => ({ ...current, priority: e.target.value })), style: styles.select, required: true },
        ...[['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']].map(([value, label]) => h('option', { key: value, value }, label))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Start date'),
      h('input', { name: 'startDate', type: 'date', value: form.startDate, onChange: (e) => setForm((current) => ({ ...current, startDate: e.target.value })), style: styles.input })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Due date'),
      h('input', { name: 'dueDate', type: 'date', value: form.dueDate, onChange: (e) => setForm((current) => ({ ...current, dueDate: e.target.value })), style: styles.input })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Summary'),
      h('textarea', { name: 'summary', value: form.summary, onChange: (e) => setForm((current) => ({ ...current, summary: e.target.value })), style: { ...styles.input, minHeight: 110 } })
    )),
    h('div', { style: styles.formFooter },
      h('button', { type: 'submit', style: styles.secondaryButton, disabled: busy }, busy ? 'Saving…' : 'Create project'),
      statusMessage ? h('div', { style: statusMessage.startsWith('Saved') ? styles.okText : styles.errorText }, statusMessage) : null
    )
  );
}

function CreateProjectJobForm({ auth, projectId, workspace, onSuccess }) {
  const profile = workspace?.profile;
  const projectType = workspace?.project?.projectType ?? 'service';
  const templateOptions = [['', 'No template'], ...((profile?.templates ?? []).map((item) => [item.key, item.name]))];
  return h(InlineCreateForm, {
    title: 'New board card',
    fields: [
      { key: 'jobType', label: 'Job type', type: 'select', options: [[projectType, profile?.label ?? projectType], ['service', 'Service'], ['installation', 'Installation']], required: true },
      { key: 'boardColumnKey', label: 'Board lane', type: 'select', options: (workspace?.columns ?? []).map((item) => [item.columnKey, item.name]) },
      { key: 'templateKey', label: 'Template', type: 'select', options: templateOptions },
      { key: 'title', label: 'Title', required: true },
      { key: 'status', label: 'Status', type: 'select', options: (profile?.cardStatuses ?? ['queued', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled']).map((item) => [item, profile?.cardStatusLabels?.[item] ?? item]), required: true },
      { key: 'priority', label: 'Priority', type: 'select', options: [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']], required: true },
      { key: 'dueAt', label: 'Due at', type: 'datetime-local' },
      { key: 'details', label: 'Details', type: 'textarea' },
    ],
    defaults: { jobType: projectType, boardColumnKey: workspace?.columns?.[0]?.columnKey ?? '', templateKey: '', status: profile?.cardStatuses?.[0] ?? 'queued', priority: 'normal', dueAt: '' },
    transform: (payload) => {
      const template = (profile?.templates ?? []).find((item) => item.key === payload.templateKey);
      const merged = {
        ...payload,
        ...(template?.card ?? {}),
        title: sanitizeText(payload.title) || template?.card?.title,
        details: sanitizeText(payload.details) || template?.card?.details,
        dueAt: payload.dueAt ? new Date(payload.dueAt).toISOString() : undefined,
      };
      delete merged.templateKey;
      return merged;
    },
    submitLabel: 'Create card',
    onSuccess,
    onSubmit: (payload) => authFetch(`/v1/projects/${projectId}/jobs`, auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) }),
  });
}

function CreateTicketForm({ auth, onSuccess }) {
  const [customers, setCustomers] = useState([]);
  const [assets, setAssets] = useState([]);
  const [form, setForm] = useState({ customerTenantId: '', assetId: '', subject: '', priority: 'normal', category: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const role = auth.session?.activeTenant?.role ?? auth.session?.user?.platformRole;
  const isCustomer = ['customer_admin', 'customer_user'].includes(role);

  useEffect(() => {
    authFetch('/v1/assets', auth.session.accessToken).then((data) => setAssets(data.assets ?? [])).catch(() => {});
    if (!isCustomer) {
      authFetch('/v1/customers', auth.session.accessToken).then((data) => setCustomers(data.customers ?? [])).catch(() => {});
    }
  }, [auth.session.accessToken, isCustomer]);

  const defaultCustomerTenantId = isCustomer ? auth.session?.activeTenant?.tenantId ?? '' : '';

  useEffect(() => {
    setForm((current) => ({
      ...current,
      customerTenantId: isCustomer ? defaultCustomerTenantId : current.customerTenantId,
    }));
  }, [isCustomer, defaultCustomerTenantId]);

  const scopedCustomerTenantId = isCustomer ? defaultCustomerTenantId : form.customerTenantId;
  const assetOptions = assets.filter((item) => !scopedCustomerTenantId || item.customerTenantId === scopedCustomerTenantId);

  const handleCustomerChange = (customerTenantId) => {
    setForm((current) => ({
      ...current,
      customerTenantId,
      assetId: current.assetId && assets.some((item) => item.assetId === current.assetId && item.customerTenantId === customerTenantId) ? current.assetId : '',
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      const payload = normalizePayload({
        customerTenantId: isCustomer ? defaultCustomerTenantId : form.customerTenantId,
        assetId: form.assetId || null,
        subject: form.subject,
        priority: form.priority,
        category: form.category,
        description: form.description,
      });
      const result = await authFetch('/v1/tickets', auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) });
      setForm({ customerTenantId: isCustomer ? defaultCustomerTenantId : '', assetId: '', subject: '', priority: 'normal', category: '', description: '' });
      setStatus('Saved. View refreshed.');
      onSuccess?.(result);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  return h('form', { style: styles.inlineForm, onSubmit: submit },
    h('strong', { style: styles.formTitle }, 'New ticket'),
    h('div', { style: styles.formFieldsGrid },
    !isCustomer ? h('label', { style: styles.inlineField },
      h('span', null, 'Customer *'),
      h('select', { name: 'customerTenantId', value: form.customerTenantId, onChange: (e) => handleCustomerChange(e.target.value), style: styles.select, required: true },
        h('option', { value: '' }, 'Select customer'),
        ...customers.map((item) => h('option', { key: item.id, value: item.id }, item.displayName))
      )
    ) : null,
    h('label', { style: styles.inlineField },
      h('span', null, 'Related asset'),
      h('select', { name: 'assetId', value: form.assetId, onChange: (e) => setForm((current) => ({ ...current, assetId: e.target.value })), style: styles.select, disabled: !isCustomer && !form.customerTenantId },
        h('option', { value: '' }, (!isCustomer && !form.customerTenantId) ? 'Select customer first' : 'No related asset'),
        ...assetOptions.map((item) => h('option', { key: item.assetId, value: item.assetId }, `${item.assetName} (${item.assetType})`))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Subject *'),
      h('input', { name: 'subject', type: 'text', value: form.subject, onChange: (e) => setForm((current) => ({ ...current, subject: e.target.value })), style: styles.input, required: true })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Priority *'),
      h('select', { name: 'priority', value: form.priority, onChange: (e) => setForm((current) => ({ ...current, priority: e.target.value })), style: styles.select, required: true },
        ...[['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']].map(([value, label]) => h('option', { key: value, value }, label))
      )
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Category'),
      h('input', { name: 'category', type: 'text', value: form.category, onChange: (e) => setForm((current) => ({ ...current, category: e.target.value })), style: styles.input })
    ),
    h('label', { style: styles.inlineField },
      h('span', null, 'Description *'),
      h('textarea', { name: 'description', value: form.description, onChange: (e) => setForm((current) => ({ ...current, description: e.target.value })), style: { ...styles.input, minHeight: 110 }, required: true })
    )),
    h('div', { style: styles.formFooter },
      h('button', { type: 'submit', style: styles.secondaryButton, disabled: busy }, busy ? 'Saving…' : 'Create ticket'),
      status ? h('div', { style: status.startsWith('Saved') ? styles.okText : styles.errorText }, status) : null
    )
  );
}

function AddTicketCommentForm({ auth, ticketId, canManage, ticket, onSuccess }) {
  return h(InlineCreateForm, {
    title: 'Reply',
    fields: [
      { key: 'body', label: 'Comment', type: 'textarea', required: true },
      ...(canManage ? [
        { key: 'status', label: 'Status', type: 'select', options: [['new', 'New'], ['open', 'Open'], ['pending_customer', 'Pending customer'], ['pending_vendor', 'Pending vendor'], ['resolved', 'Resolved'], ['closed', 'Closed']] },
        { key: 'isCustomerVisible', label: 'Customer visible', type: 'select', options: [['true', 'Visible to customer'], ['false', 'Internal only']] },
      ] : []),
    ],
    defaults: { status: ticket?.status ?? 'open', isCustomerVisible: 'true' },
    submitLabel: 'Post reply',
    transform: (payload) => ({ ...payload, isCustomerVisible: payload.isCustomerVisible !== 'false' }),
    onSuccess,
    onSubmit: (payload) => authFetch(`/v1/tickets/${ticketId}/comments`, auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) }),
  });
}

function UpdateTicketForm({ auth, ticketId, ticket, onSuccess }) {
  const [members, setMembers] = useState([]);

  useEffect(() => {
    authFetch(`/v1/tenants/${auth.session.activeTenant.tenantId}/members`, auth.session.accessToken)
      .then((data) => setMembers(data.members ?? []))
      .catch(() => setMembers([]));
  }, [auth.session.accessToken, auth.session.activeTenant?.tenantId]);

  return h(InlineCreateForm, {
    title: 'Update ticket',
    fields: [
      { key: 'status', label: 'Status', type: 'select', options: [['new', 'New'], ['open', 'Open'], ['pending_customer', 'Pending customer'], ['pending_vendor', 'Pending vendor'], ['resolved', 'Resolved'], ['closed', 'Closed']] },
      { key: 'priority', label: 'Priority', type: 'select', options: [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']] },
      { key: 'assignedUserId', label: 'Assigned user', type: 'select', options: members.map((member) => [member.userId, `${member.fullName} (${member.role})`]) },
      ['category', 'Category'],
    ],
    defaults: {
      status: ticket?.status ?? 'open',
      priority: ticket?.priority ?? 'normal',
      assignedUserId: ticket?.assignedUserId ?? '',
      category: ticket?.category ?? '',
    },
    submitLabel: 'Save changes',
    transform: (payload) => ({ ...payload, assignedUserId: payload.assignedUserId || null }),
    onSuccess,
    onSubmit: (payload) => authFetch(`/v1/tickets/${ticketId}`, auth.session.accessToken, { method: 'PATCH', body: JSON.stringify(payload) }),
  });
}

function CreateTicketConversionForm({ auth, ticketId, onSuccess }) {
  return h(InlineCreateForm, {
    title: 'Convert downstream',
    fields: [
      { key: 'conversionType', label: 'Conversion type', type: 'select', options: [['service_job', 'Service job'], ['installation_project', 'Installation project'], ['internal_project_task', 'Internal project task']], required: true },
      { key: 'status', label: 'Status', type: 'select', options: [['planned', 'Planned'], ['queued', 'Queued'], ['created', 'Created'], ['cancelled', 'Cancelled']] },
      ['targetRef', 'Reference'],
      ['summary', 'Summary'],
    ],
    defaults: { conversionType: 'service_job', status: 'planned' },
    submitLabel: 'Record conversion',
    onSuccess,
    onSubmit: (payload) => authFetch(`/v1/tickets/${ticketId}/conversions`, auth.session.accessToken, { method: 'POST', body: JSON.stringify(payload) }),
  });
}

function InlineCreateForm({ title, fields, onSubmit, submitLabel, defaults = {}, transform = (payload) => payload, onSuccess, onChange, successMessage = 'Saved. View refreshed.', busyLabel = 'Saving…', beforeFields = null }) {
  const schemaKey = useMemo(() => JSON.stringify({
    defaults,
    fields: fields.map((field) => {
      const normalized = normalizeFieldConfig(field);
      return {
        key: normalized.key,
        type: normalized.type,
        required: Boolean(normalized.required),
        hint: normalized.hint ?? '',
        options: normalized.options ?? [],
      };
    }),
  }), [fields, defaults]);
  const normalizedFields = useMemo(() => fields.map(normalizeFieldConfig), [schemaKey]);
  const initial = useMemo(() => Object.fromEntries(normalizedFields.map((field) => [field.key, defaults[field.key] ?? ''])), [schemaKey]);
  const fieldKeys = useMemo(() => normalizedFields.map((field) => field.key), [schemaKey]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState('ok');

  useEffect(() => {
    setForm((current) => reconcileFormState(current, initial, fieldKeys));
  }, [schemaKey]);

  const updateForm = (updater) => {
    setForm((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      const adjusted = onChange?.(next, current);
      return adjusted && typeof adjusted === 'object' ? adjusted : next;
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    setStatusTone('ok');
    try {
      const visibleForm = snapshotVisibleForm(event.currentTarget, normalizedFields);
      const payload = normalizePayload(transform({ ...form, ...visibleForm }));
      const result = await onSubmit(payload);
      setStatus(successMessage);
      setStatusTone('ok');
      setForm(initial);
      onSuccess?.(result);
    } catch (error) {
      setStatus(error.message);
      setStatusTone('error');
    } finally {
      setBusy(false);
    }
  };

  return h('form', { style: styles.inlineForm, onSubmit: submit },
    h('strong', { style: styles.formTitle }, title),
    beforeFields ? beforeFields({ form, updateForm, busy, status }) : null,
    h('div', { style: styles.formFieldsGrid }, ...normalizedFields.map((field) => {
      const isWide = field.type === 'textarea';
      if (field.type === 'select') {
        return h('label', { key: field.key, style: { ...styles.inlineField, ...(isWide ? styles.inlineFieldWide : {}) } },
          h('span', { style: styles.fieldText }, field.required ? `${field.label} *` : field.label),
          h('select', { name: field.key, value: form[field.key] ?? '', onChange: (e) => updateForm((current) => ({ ...current, [field.key]: e.target.value })), style: styles.select, required: field.required },
            h('option', { value: '' }, `Select ${field.label.toLowerCase()}`),
            ...(field.options ?? []).map(([value, name]) => h('option', { key: value, value }, name))
          ),
          field.hint ? h('span', { style: styles.fieldHint }, field.hint) : null
        );
      }

      return h('label', { key: field.key, style: { ...styles.inlineField, ...(isWide ? styles.inlineFieldWide : {}) } },
        h('span', { style: styles.fieldText }, field.required ? `${field.label} *` : field.label),
        h(field.type === 'textarea' ? 'textarea' : 'input', {
          name: field.key,
          type: field.type === 'textarea' ? undefined : field.type,
          value: form[field.key] ?? '',
          onChange: (e) => updateForm((current) => ({ ...current, [field.key]: e.target.value })),
          style: { ...styles.input, minHeight: field.type === 'textarea' ? 110 : undefined },
          required: field.required,
        }),
        field.hint ? h('span', { style: styles.fieldHint }, field.hint) : null
      );
    })),
    h('div', { style: styles.formFooter },
      h('button', { type: 'submit', style: styles.secondaryButton, disabled: busy }, busy ? busyLabel : submitLabel),
      status ? h('div', { style: statusTone === 'error' ? styles.errorText : styles.okText }, status) : null
    )
  );
}

function normalizeFieldConfig(field) {
  if (Array.isArray(field)) {
    const [key, label, type = 'text', options = []] = field;
    return { key, label, type, options, required: false, hint: '' };
  }
  return { type: 'text', options: [], required: false, hint: '', ...field };
}

function sanitizeTheme(value) {
  const normalized = sanitizeText(value);
  return ['ember', 'obsidian', 'aurora'].includes(normalized) ? normalized : defaultBrand.theme;
}

async function copyText(value) {
  const next = String(value ?? '');
  if (!next) throw new Error('Nothing to copy.');
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard copy is not available in this browser.');
  await navigator.clipboard.writeText(next);
}

function downloadTextFile(fileName, content, mediaType = 'text/plain;charset=utf-8') {
  if (typeof document === 'undefined') return;
  const blob = new Blob([String(content ?? '')], { type: mediaType });
  downloadBlob(fileName, blob);
}

function downloadArtifact(artifact) {
  if (!artifact || typeof document === 'undefined') return;
  if (artifact.encoding === 'base64' && artifact.contentBase64) {
    const bytes = base64ToUint8Array(artifact.contentBase64);
    downloadBlob(artifact.fileName || 'download.bin', new Blob([bytes], { type: artifact.mediaType || 'application/octet-stream' }));
    return;
  }

  downloadTextFile(artifact.fileName || 'download.txt', artifact.content || '', artifact.mediaType || 'text/plain;charset=utf-8');
}

function downloadBlob(fileName, blob) {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || 'download.bin';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function base64ToUint8Array(value) {
  const decoded = typeof atob === 'function' ? atob(value) : '';
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function sanitizeHexColor(value) {
  const normalized = sanitizeText(value);
  if (!normalized) return '';
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized) ? normalized : '';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function useViewport(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(query);
    const handler = () => setMatches(media.matches);
    handler();
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

function normalizeRoleSummaries(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (typeof item === 'string') return { role: item, permissions: [] };
      if (item && typeof item === 'object' && typeof item.role === 'string') {
        return {
          role: item.role,
          permissions: Array.isArray(item.permissions)
            ? item.permissions.map((permission) => safeText(permission)).filter(Boolean)
            : [],
        };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeAdminOverview(input) {
  const overview = input && typeof input === 'object' ? input : {};
  const tenantSettings = normalizeAdminSettings(overview.tenant?.settings);
  return {
    tenant: {
      settings: tenantSettings,
    },
    roles: normalizeRoleSummaries(overview.roles),
    operatorRoles: normalizeRoleSummaries(overview.operatorRoles),
    members: Array.isArray(overview.members) ? overview.members.map(normalizeAdminMember).filter(Boolean) : [],
    customers: Array.isArray(overview.customers) ? overview.customers : [],
    projectCatalog: Array.isArray(overview.projectCatalog) ? overview.projectCatalog.map(normalizeProjectCatalogEntry).filter(Boolean) : [],
    stats: {
      ticketing: {
        open: normalizeCount(overview.stats?.ticketing?.open),
      },
      delivery: {
        open_jobs: normalizeCount(overview.stats?.delivery?.open_jobs),
      },
    },
  };
}

function normalizeAdminSettings(settings) {
  const effective = settings && typeof settings === 'object' ? settings : {};
  return {
    branding: {
      brandName: safeText(effective.branding?.brandName, defaultBrand.name),
      product: safeText(effective.branding?.product, defaultBrand.product),
      shell: safeText(effective.branding?.shell, defaultBrand.shell),
      eyebrow: safeText(effective.branding?.eyebrow, defaultBrand.eyebrow),
      authLabel: safeText(effective.branding?.authLabel, defaultBrand.authLabel),
      supportLabel: safeText(effective.branding?.supportLabel, defaultBrand.supportLabel),
      sidebarFooter: safeText(effective.branding?.sidebarFooter, defaultBrand.sidebarFooter),
      headerLogoUrl: sanitizeUrlOrDataUri(effective.branding?.headerLogoUrl),
      headerImageUrl: sanitizeUrlOrDataUri(effective.branding?.headerImageUrl),
      theme: sanitizeTheme(effective.branding?.theme),
      accentColor: sanitizeHexColor(effective.branding?.accentColor),
    },
    platformDefaults: {
      defaultProjectPriority: safeText(effective.platformDefaults?.defaultProjectPriority, 'normal'),
    },
    helpdeskDefaults: {
      defaultTicketPriority: safeText(effective.helpdeskDefaults?.defaultTicketPriority, 'normal'),
      staleAfterHours: normalizeCount(effective.helpdeskDefaults?.staleAfterHours, 24),
    },
    serviceDefaults: {
      defaultDispatchColumn: safeText(effective.serviceDefaults?.defaultDispatchColumn, 'dispatch'),
    },
    workflowDefaults: {
      myWorkMode: safeText(effective.workflowDefaults?.myWorkMode, 'assigned-only'),
    },
  };
}

function normalizeAdminMember(member) {
  if (!member || typeof member !== 'object') return null;
  return {
    ...member,
    userId: safeText(member.userId),
    fullName: safeText(member.fullName, '—'),
    email: safeText(member.email, '—'),
    role: safeText(member.role, 'technician'),
    status: safeText(member.status, 'active'),
    lastLoginAt: member.lastLoginAt ?? null,
  };
}

function normalizeProjectCatalogEntry(profile) {
  if (!profile || typeof profile !== 'object') return null;
  return {
    key: safeText(profile.key),
    label: safeText(profile.label, 'Project profile'),
    description: safeText(profile.description, 'No description available.'),
  };
}

function normalizeCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function readInitial(primary, fallback = '') {
  const source = safeText(primary) || safeText(fallback) || 'A';
  return source.slice(0, 1).toUpperCase();
}

function reconcileFormState(current, initial, fieldKeys) {
  let changed = false;
  const next = {};
  for (const key of fieldKeys) {
    const value = current?.[key] ?? initial[key] ?? '';
    next[key] = value;
    if (!Object.is(current?.[key], value)) changed = true;
  }
  const currentKeys = current ? Object.keys(current) : [];
  if (!changed && currentKeys.length === fieldKeys.length) return current;
  return next;
}

function snapshotVisibleForm(formElement, normalizedFields) {
  const formData = new FormData(formElement);
  const next = {};
  for (const field of normalizedFields) {
    const value = formData.get(field.key);
    next[field.key] = typeof value === 'string' ? value : '';
  }
  return next;
}

function StatsGrid({ items }) {
  return h('div', { style: styles.statsGrid }, ...items.map((item) => h('article', { key: item.label, style: { ...styles.statCard, borderColor: toneColor(item.tone) } }, h('div', { style: styles.statLabel }, item.label), h('div', { style: styles.statValue }, String(item.value)))));
}
function TwoColumn({ left, right }) { return h('div', { style: styles.twoColumn }, left, right); }
function Panel({ title, children }) { return h('section', { style: styles.panel }, h('h3', { style: styles.panelTitle }, title), children); }
function MutedCopy({ children }) { return h('p', { style: styles.muted }, children); }
function RowLink({ title, meta, onClick }) { return h('button', { style: styles.rowLink, onClick, type: 'button' }, h('strong', null, title), h('div', { style: styles.muted }, meta)); }
function EmptyState({ title, message }) { return h(Panel, { title }, h(MutedCopy, null, message)); }
function FullscreenState({ title, message }) { return h('div', { style: styles.centerScreen }, h(Panel, { title }, h(MutedCopy, null, message))); }
function InfoCard({ title, subtitle, items, onClick, compact = false }) { return h('button', { style: { ...styles.infoCard, ...(compact ? styles.infoCardCompact : {}) }, onClick, type: 'button' }, h('strong', null, title), h('div', { style: styles.muted }, subtitle), h('div', { style: styles.stack }, ...items.map(([label, val]) => h('div', { key: label, style: styles.splitRow }, h('span', { style: styles.muted }, label), h('span', null, String(val)))))); }
function AlertBanner({ flash, onClose }) { return h('div', { style: { ...styles.banner, borderColor: toneColor(flash.type === 'warning' ? 'amber' : flash.type === 'error' ? 'red' : 'blue') } }, h('span', null, flash.message), onClose ? h('button', { style: styles.ghostButton, onClick: onClose, type: 'button' }, 'Dismiss') : null); }
function AuthLayout({ title, subtitle, children }) { return h('div', { style: styles.centerScreen }, h('section', { style: styles.authCard }, h('div', { style: styles.authBrandMark }, defaultBrand.name.slice(0, 1)), h('p', { style: styles.kicker }, defaultBrand.authLabel), h('h1', { style: styles.pageTitle }, title), h('p', { style: styles.pageSubtitle }, subtitle), children)); }

function SimpleTable({ columns, rows }) {
  return h('div', { style: styles.tableWrap },
    h('table', { style: styles.table },
      h('thead', null, h('tr', null, ...columns.map((column) => h('th', { key: column, style: styles.th }, column)))),
      h('tbody', null, ...rows.map((row, index) => h('tr', { key: index }, ...row.map((cell, cellIndex) => h('td', { key: `${index}-${cellIndex}`, style: styles.td }, renderCell(cell))))))
    )
  );
}

function renderCell(cell) { return cell && cell.__kind === 'link' ? h('button', { style: styles.tableLink, onClick: cell.onClick, type: 'button' }, cell.label) : cell && cell.__kind === 'badge' ? h('span', { style: badgeStyle(cell.value) }, cell.value) : cell; }
function linkCell(label, onClick) { return { __kind: 'link', label, onClick }; }
function badge(value) { return { __kind: 'badge', value }; }
function badgeStyle(value) { return { ...styles.badge, background: `${toneColor(severityTone(value))}22`, color: toneColor(severityTone(value)), border: `1px solid ${toneColor(severityTone(value))}66` }; }
function navLink(item, route, setRoute) { const active = route.path === item.href || (item.href !== '/dashboard' && route.path.startsWith(item.href + '/')); return h('button', { key: item.href, style: { ...styles.navLink, ...(active ? styles.navLinkActive : {}) }, onClick: () => navigate(item.href, setRoute), type: 'button' }, item.label); }
function field(label, type, value, onChange, hint = '') { return h('label', { style: styles.field }, h('span', { style: styles.fieldLabel }, label), h('input', { style: styles.input, type, value, onChange: (event) => onChange(event.target.value) }), hint ? h('span', { style: styles.fieldHint }, hint) : null); }
function listOrEmpty(items, empty) { return items.length ? h('ul', { style: styles.list }, ...items.map((item, index) => h('li', { key: index }, item))) : h(MutedCopy, null, empty); }
function formatTime(value) { return value ? new Date(value).toLocaleString() : '—'; }
function getBrand(session) {
  const sources = [
    session?.activeTenant?.settings?.branding,
    session?.memberships?.find((membership) => membership.tenantId === session?.activeTenant?.tenantId)?.settings?.branding,
    session?.memberships?.find((membership) => membership.isPrimary)?.settings?.branding,
  ].filter(Boolean);
  const branding = sources[0] ?? {};
  return {
    ...defaultBrand,
    ...branding,
    headerLogoUrl: sanitizeUrlOrDataUri(branding.headerLogoUrl ?? defaultBrand.headerLogoUrl),
    headerImageUrl: sanitizeUrlOrDataUri(branding.headerImageUrl ?? defaultBrand.headerImageUrl),
    theme: sanitizeTheme(branding.theme ?? defaultBrand.theme),
    accentColor: sanitizeHexColor(branding.accentColor ?? defaultBrand.accentColor),
  };
}
function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
}
function value(number) { return number == null ? 'n/a' : `${number}%`; }
function toneColor(tone) { return tone === 'red' ? '#f87171' : tone === 'amber' ? '#fbbf24' : tone === 'green' ? '#34d399' : tone === 'blue' ? 'var(--shell-accent-soft)' : 'var(--shell-border)'; }
function severityTone(value) { return ['critical', 'offline', 'urgent'].includes(value) ? 'red' : ['warning', 'queued', 'draft', 'pending_customer', 'pending_vendor', 'high'].includes(value) ? 'amber' : ['approved', 'open', 'online', 'active', 'resolved', 'normal', 'low', 'new'].includes(value) ? 'green' : 'blue'; }
function hasRole(session, allowed) { const role = session?.activeTenant?.role ?? session?.user?.platformRole; return allowed.includes(role) || session?.user?.platformRole === 'platform_admin'; }
function navigate(path, setRoute) { window.history.pushState({}, '', path); setRoute(readRoute()); }
function updateQuery(nextQuery, setRoute) {
  const params = new URLSearchParams(window.location.search || '');
  Object.entries(nextQuery).forEach(([key, value]) => {
    if (value == null || value === '') params.delete(key);
    else params.set(key, value);
  });
  const queryString = params.toString();
  navigate(`${window.location.pathname}${queryString ? `?${queryString}` : ''}`, setRoute);
}
function readRoute() {
  return {
    path: window.location.pathname || '/',
    search: window.location.search || '',
    query: Object.fromEntries(new URLSearchParams(window.location.search || '')),
  };
}
function readSession() {
  try {
    const raw = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem('norton-msp-session');
    return normalizeSessionPayload(raw ? JSON.parse(raw) : null);
  } catch {
    return null;
  }
}
function persistSession(session) {
  const normalized = normalizeSessionPayload(session);
  if (!normalized) return clearSession();
  window.localStorage.setItem(storageKey, JSON.stringify(normalized));
}
function clearSession(options = {}) {
  window.localStorage.removeItem(storageKey);
  window.localStorage.removeItem('norton-msp-session');
  if (options.clearHints) {
    clearHint('login-email');
    clearHint('login-tenant-key');
  }
}
function handleNewSession(payload, auth, setFlash, setRoute, options = {}) {
  const session = normalizeSessionPayload(payload);
  if (!session?.accessToken) {
    clearSession({ clearHints: true });
    setFlash({ type: 'warning', message: 'Sign-in could not be completed. Please try again.' });
    navigate('/login', setRoute);
    return;
  }
  auth.setSession(session);
  if (session?.user?.email) writeHint('login-email', session.user.email);
  if (session?.activeTenant?.tenantKey) writeHint('login-tenant-key', session.activeTenant.tenantKey);
  setFlash({ type: 'info', message: options.welcomeMessage ?? `Signed in as ${session.user?.fullName ?? session.user?.email}.` });
  navigate('/dashboard', setRoute);
}

function normalizeSessionPayload(payload) {
  const rawSession = payload?.accessToken ? payload : payload?.session?.accessToken ? payload.session : null;
  if (!rawSession?.accessToken) return null;

  const memberships = Array.isArray(rawSession.memberships) ? rawSession.memberships : [];
  const normalizedActiveTenant = normalizeTenantRecord(rawSession.activeTenant)
    ?? normalizeTenantRecord(memberships.find((membership) => membership?.tenantId === rawSession.activeTenant?.tenantId))
    ?? normalizeTenantRecord(memberships.find((membership) => membership?.isPrimary))
    ?? normalizeTenantRecord(memberships[0]);

  return {
    ...rawSession,
    user: normalizeUserRecord(rawSession.user),
    activeTenant: normalizedActiveTenant,
    memberships: memberships.map((membership) => normalizeMembershipRecord(membership, normalizedActiveTenant)).filter(Boolean),
  };
}

function normalizeUserRecord(user) {
  if (!user || typeof user !== 'object') return user ?? null;
  return {
    ...user,
    fullName: user.fullName ?? user.full_name ?? null,
    platformRole: user.platformRole ?? user.role ?? null,
  };
}

function normalizeTenantRecord(tenant) {
  if (!tenant || typeof tenant !== 'object') return null;
  return {
    ...tenant,
    tenantId: tenant.tenantId ?? tenant.id ?? null,
    tenantKey: tenant.tenantKey ?? tenant.tenant_key ?? null,
    displayName: tenant.displayName ?? tenant.display_name ?? null,
    parentTenantId: tenant.parentTenantId ?? tenant.parent_tenant_id ?? null,
    settings: tenant.settings ?? {},
    role: tenant.role ?? null,
    isPrimary: tenant.isPrimary ?? tenant.is_primary ?? false,
  };
}

function normalizeMembershipRecord(membership, activeTenant) {
  const normalized = normalizeTenantRecord(membership);
  if (!normalized) return null;
  if (activeTenant?.tenantId && normalized.tenantId === activeTenant.tenantId) {
    normalized.settings = activeTenant.settings ?? normalized.settings ?? {};
    normalized.role = activeTenant.role ?? normalized.role;
    normalized.isPrimary = activeTenant.isPrimary ?? normalized.isPrimary;
  }
  return normalized;
}

function readHint(key) {
  try {
    return window.localStorage.getItem(`aetnix:${key}`)
      ?? window.localStorage.getItem(`norton:${key}`)
      ?? '';
  } catch {
    return '';
  }
}
function writeHint(key, value) { try { if (!value) return; window.localStorage.setItem(`aetnix:${key}`, value); } catch {} }
function clearHint(key) {
  try {
    window.localStorage.removeItem(`aetnix:${key}`);
    window.localStorage.removeItem(`norton:${key}`);
  } catch {}
}

function sanitizeText(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function sanitizeUrlOrDataUri(value) {
  const normalized = sanitizeText(value);
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (/^data:image\//i.test(normalized)) return normalized;
  return '';
}

function sanitizeTenantKey(value) {
  const normalized = sanitizeText(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (!/^[a-z0-9-]+$/.test(normalized)) throw new Error('Tenant key must contain only lowercase letters, numbers, and hyphens.');
  return normalized;
}

function assertOutgoingJsonShape(payload, { required = [], allowed = [] } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid payload shape.');
  for (const key of required) {
    if (payload[key] == null || payload[key] === '') throw new Error(`${key} is required.`);
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(payload)) {
    if (!allowedSet.has(key)) throw new Error(`Unexpected payload field: ${key}`);
  }
  return payload;
}

function buildCustomerCreatePayload(form) {
  const payload = {
    displayName: sanitizeText(form.displayName),
    tenantKey: sanitizeTenantKey(form.tenantKey),
  };
  return assertOutgoingJsonShape(payload, {
    required: ['displayName', 'tenantKey'],
    allowed: ['displayName', 'tenantKey'],
  });
}

function buildCustomerAdminPayload(form) {
  const payload = {
    fullName: sanitizeText(form.fullName),
    email: sanitizeText(form.email)?.toLowerCase(),
    password: typeof form.password === 'string' ? form.password : undefined,
    role: sanitizeText(form.role),
  };
  if (!['customer_admin', 'customer_user'].includes(payload.role)) throw new Error('Role must be customer_admin or customer_user.');
  return assertOutgoingJsonShape(payload, {
    required: ['fullName', 'email', 'password', 'role'],
    allowed: ['fullName', 'email', 'password', 'role'],
  });
}

function buildSiteCreatePayload(form) {
  const payload = normalizePayload({
    name: sanitizeText(form.name),
    siteCode: sanitizeText(form.siteCode),
    city: sanitizeText(form.city),
    stateRegion: sanitizeText(form.stateRegion),
    countryCode: sanitizeText(form.countryCode)?.toUpperCase(),
  });
  return assertOutgoingJsonShape(payload, {
    required: ['name'],
    allowed: ['name', 'siteCode', 'city', 'stateRegion', 'countryCode'],
  });
}

function buildAssetCreatePayload(form) {
  const payload = normalizePayload({
    customerTenantId: sanitizeText(form.customerTenantId),
    siteId: sanitizeText(form.siteId) || null,
    assetName: sanitizeText(form.assetName),
    assetType: sanitizeText(form.assetType) || 'other',
    status: sanitizeText(form.status) || 'unknown',
    hostname: sanitizeText(form.hostname),
    primaryIp: sanitizeText(form.primaryIp),
    manufacturer: sanitizeText(form.manufacturer),
    model: sanitizeText(form.model),
    serialNumber: sanitizeText(form.serialNumber),
    operatingSystem: sanitizeText(form.operatingSystem),
    warrantyExpiresAt: normalizeDateInput(form.warrantyExpiresAt) ?? null,
    lifecycleState: sanitizeText(form.lifecycleState) || 'active',
    notes: sanitizeText(form.notes),
  });
  return assertOutgoingJsonShape(payload, {
    required: ['customerTenantId', 'assetName', 'assetType', 'status'],
    allowed: ['customerTenantId', 'siteId', 'assetName', 'assetType', 'status', 'hostname', 'primaryIp', 'manufacturer', 'model', 'serialNumber', 'operatingSystem', 'warrantyExpiresAt', 'lifecycleState', 'notes'],
  });
}

function buildAssetUpdatePayload(form) {
  const payload = normalizePayload({
    siteId: sanitizeText(form.siteId) || null,
    assetName: sanitizeText(form.assetName),
    assetType: sanitizeText(form.assetType) || 'other',
    status: sanitizeText(form.status) || 'unknown',
    hostname: sanitizeText(form.hostname),
    primaryIp: sanitizeText(form.primaryIp),
    manufacturer: sanitizeText(form.manufacturer),
    model: sanitizeText(form.model),
    serialNumber: sanitizeText(form.serialNumber),
    operatingSystem: sanitizeText(form.operatingSystem),
    warrantyExpiresAt: normalizeDateInput(form.warrantyExpiresAt) ?? null,
    lifecycleState: sanitizeText(form.lifecycleState) || 'active',
    notes: sanitizeText(form.notes),
  });
  return assertOutgoingJsonShape(payload, {
    required: ['assetName', 'assetType', 'status', 'lifecycleState'],
    allowed: ['siteId', 'assetName', 'assetType', 'status', 'hostname', 'primaryIp', 'manufacturer', 'model', 'serialNumber', 'operatingSystem', 'warrantyExpiresAt', 'lifecycleState', 'notes'],
  });
}

function createAssetEditorState(asset) {
  return {
    siteId: asset?.siteId ?? '',
    assetName: asset?.assetName ?? '',
    assetType: asset?.assetType ?? 'other',
    status: asset?.status ?? 'unknown',
    hostname: asset?.hostname ?? '',
    primaryIp: asset?.primaryIp ?? '',
    manufacturer: asset?.manufacturer ?? '',
    model: asset?.model ?? '',
    serialNumber: asset?.serialNumber ?? '',
    operatingSystem: asset?.operatingSystem ?? '',
    warrantyExpiresAt: asset?.warrantyExpiresAt ? String(asset.warrantyExpiresAt).slice(0, 10) : '',
    lifecycleState: asset?.lifecycleState ?? 'active',
    notes: asset?.notes ?? '',
  };
}

function buildProjectCreatePayload(form, projectProfiles) {
  const projectType = sanitizeText(form.projectType) || 'service';
  const activeProfile = projectProfiles.find((item) => item.key === projectType) ?? projectProfiles[0];
  const template = (activeProfile?.templates ?? []).find((item) => item.key === form.templateKey);
  const payload = normalizePayload({
    name: sanitizeText(form.name),
    projectType,
    customerTenantId: projectType === 'internal' ? null : sanitizeText(form.customerTenantId) ?? null,
    status: sanitizeText(form.status) || template?.project?.status || activeProfile?.projectStatuses?.[0] || 'draft',
    priority: sanitizeText(form.priority) || template?.project?.priority || 'normal',
    startDate: normalizeDateInput(form.startDate) ?? null,
    dueDate: normalizeDateInput(form.dueDate) ?? null,
    summary: sanitizeText(form.summary),
  });

  if (!payload.name) throw new Error('Project name is required.');
  if (projectType !== 'internal' && !payload.customerTenantId) throw new Error('Customer is required for non-internal projects.');
  if (form.startDate && !payload.startDate) throw new Error('Start date must be a valid date.');
  if (form.dueDate && !payload.dueDate) throw new Error('Due date must be a valid date.');
  return assertOutgoingJsonShape(payload, {
    required: ['name', 'projectType', 'status', 'priority'],
    allowed: ['name', 'projectType', 'customerTenantId', 'status', 'priority', 'startDate', 'dueDate', 'summary'],
  });
}

function normalizeDateInput(value) {
  const trimmed = sanitizeText(value);
  if (!trimmed) return undefined;
  const match = String(trimmed).match(/^\d{4}-\d{2}-\d{2}$/);
  if (match) return match[0];
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function normalizePayload(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (Array.isArray(value)) return value.map((item) => normalizePayload(item)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([key, current]) => [key, normalizePayload(current)])
      .filter(([, current]) => current !== undefined));
  }
  return value;
}

async function fetchJson(path, init = {}) {
  const mergedHeaders = {
    'content-type': 'application/json',
    ...(init.headers ?? {}),
  };
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: mergedHeaders,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed with status ${response.status}`);
  return payload;
}
async function authFetch(path, accessToken, init = {}) {
  return fetchJson(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${accessToken}`,
    },
  });
}

function resolveThemeTokens(brand) {
  const presets = {
    ember: {
      shellBg: '#090f19', shellBgAlt: '#0d1422', shellPanel: '#111827', shellPanelAlt: '#0f172a', shellBorder: '#263246',
      shellMuted: '#94a3b8', shellText: '#e5eefc', shellSidebarFrom: '#13090c', shellSidebarMid: '#0b1020', shellSidebarTo: '#070b12',
      shellSidebarBorder: '#41181c', shellNavActive: 'rgba(255,106,61,0.16)', shellAccent: '#ff6a3d', shellAccentSoft: '#ff8a5b', shellAccentStrong: '#c12a1a'
    },
    obsidian: {
      shellBg: '#0a0d14', shellBgAlt: '#101522', shellPanel: '#121826', shellPanelAlt: '#0d1522', shellBorder: '#283244',
      shellMuted: '#97a3b8', shellText: '#edf2ff', shellSidebarFrom: '#0f1118', shellSidebarMid: '#0b1220', shellSidebarTo: '#070b12',
      shellSidebarBorder: '#1f2a3d', shellNavActive: 'rgba(96,165,250,0.14)', shellAccent: '#60a5fa', shellAccentSoft: '#8ec5ff', shellAccentStrong: '#2563eb'
    },
    aurora: {
      shellBg: '#08111a', shellBgAlt: '#0f1825', shellPanel: '#101a29', shellPanelAlt: '#0c1624', shellBorder: '#244053',
      shellMuted: '#96a8bb', shellText: '#ecf7ff', shellSidebarFrom: '#07141a', shellSidebarMid: '#0a1824', shellSidebarTo: '#071018', shellSidebarBorder: '#1f4751', shellNavActive: 'rgba(45,212,191,0.14)', shellAccent: '#2dd4bf', shellAccentSoft: '#67e8f9', shellAccentStrong: '#0f766e'
    },
  };
  const base = presets[sanitizeTheme(brand?.theme)] ?? presets.ember;
  const accent = sanitizeHexColor(brand?.accentColor) || base.shellAccent;
  return { ...base, shellAccent: accent };
}

function applyTheme(brand) {
  if (typeof document === 'undefined') return;
  const tokens = resolveThemeTokens(brand);
  const root = document.documentElement;
  Object.entries(tokens).forEach(([key, value]) => root.style.setProperty(`--${camelToKebab(key)}`, String(value)));
  document.body.style.background = 'var(--shell-bg)';
  document.body.style.color = 'var(--shell-text)';
}

function camelToKebab(value) {
  return String(value).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

const styles = {
  appShell: { display: 'grid', gridTemplateColumns: '280px 1fr', minHeight: '100vh', background: 'var(--shell-bg)', color: 'var(--shell-text)' },
  appShellMobile: { gridTemplateColumns: '1fr' },
  desktopSidebarWrap: { display: 'block' },
  desktopSidebarWrapHidden: { display: 'none' },
  mobileSidebarWrap: { display: 'none' },
  mobileSidebarWrapActive: { display: 'block', position: 'fixed', inset: '0 auto 0 0', width: 'min(88vw, 360px)', zIndex: 35, transform: 'translateX(-104%)', transition: 'transform 180ms ease' },
  mobileBackdrop: { display: 'none' },
  mobileBackdropActive: { display: 'block', position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.66)', opacity: 0, pointerEvents: 'none', transition: 'opacity 180ms ease', zIndex: 34 },
  mobileBackdropVisible: { opacity: 1, pointerEvents: 'auto' },
  mobileSidebarWrapOpen: { transform: 'translateX(0)' },
  sidebar: { position: 'relative', background: 'linear-gradient(180deg, var(--shell-sidebar-from) 0%, var(--shell-sidebar-mid) 42%, var(--shell-sidebar-to) 100%)', borderRight: '1px solid var(--shell-sidebar-border)', padding: 24, display: 'flex', flexDirection: 'column', gap: 20, overflow: 'hidden', minHeight: '100vh' },
  sidebarWithImage: {},
  sidebarImage: { position: 'absolute', inset: 0, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.46, pointerEvents: 'none' },
  sidebarInner: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 20, minHeight: '100%' },
  brandBlock: { paddingBottom: 12, borderBottom: '1px solid var(--shell-sidebar-border)' },
  brandMark: { width: 52, height: 52, display: 'grid', placeItems: 'center', marginBottom: 12, borderRadius: 16, fontSize: 28, fontWeight: 800, color: '#fff7f3', background: 'radial-gradient(circle at 35% 25%, var(--shell-accent-soft) 0%, var(--shell-accent) 36%, var(--shell-accent-strong) 72%, #1a0e16 100%)', boxShadow: '0 18px 48px rgba(0,0,0,0.24)' },
  mobileBrandMark: { width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 12, fontWeight: 800, color: '#fff7f3', background: 'linear-gradient(135deg, var(--shell-accent) 0%, var(--shell-accent-strong) 100%)' },
  brandLogo: { width: 96, maxWidth: '100%', maxHeight: 72, objectFit: 'contain', objectPosition: 'left center', marginBottom: 12, borderRadius: 0, background: 'transparent', padding: 0, filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.28))' },
  brandPreviewLogo: { width: 180, maxWidth: '100%', maxHeight: 72, objectFit: 'contain', objectPosition: 'left center', borderRadius: 0, background: 'transparent', padding: 0, filter: 'drop-shadow(0 12px 26px rgba(0,0,0,0.24))' },
  brandEyebrow: { color: 'var(--shell-accent-soft)', textTransform: 'uppercase', letterSpacing: '0.14em', fontSize: 12 },
  brandTitle: { margin: '8px 0 6px', fontSize: 28 },
  brandText: { margin: 0, color: 'var(--shell-muted)' },
  nav: { display: 'flex', flexDirection: 'column', gap: 8 },
  navLink: { background: 'transparent', border: '1px solid transparent', color: '#cbd5e1', padding: '12px 14px', borderRadius: 12, textAlign: 'left', cursor: 'pointer' },
  navLinkActive: { background: 'var(--shell-nav-active)', borderColor: 'var(--shell-accent-strong)', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' },
  sidebarFooter: { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },
  userCard: { padding: 14, background: 'var(--shell-panel)', border: '1px solid var(--shell-border)', borderRadius: 12 },
  main: { padding: '28px clamp(16px, 3vw, 32px)', background: 'var(--shell-bg)', minWidth: 0, overflowX: 'hidden' },
  pageSection: { width: '100%', maxWidth: 1320, margin: '0 auto' },
  pageHeader: { display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap' },
  pageHeaderBody: { minWidth: 0, maxWidth: 880 },
  kicker: { color: 'var(--shell-accent-soft)', textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 12, margin: '0 0 10px' },
  pageTitle: { margin: 0, fontSize: 'clamp(28px, 4vw, 34px)', overflowWrap: 'anywhere' },
  pageSubtitle: { color: 'var(--shell-muted)', maxWidth: 760, lineHeight: 1.5, overflowWrap: 'anywhere' },
  actionBand: { display: 'grid', justifyItems: 'center', marginBottom: 22 },
  actionRail: { width: '100%', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', gap: 14 },
  panel: { background: 'var(--shell-panel)', border: '1px solid var(--shell-border)', borderRadius: 18, padding: '18px clamp(14px, 2.2vw, 22px)', marginBottom: 18, minWidth: 0, overflowWrap: 'anywhere' },
  panelTitle: { marginTop: 0, marginBottom: 16, fontSize: 18 },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 },
  cardGridCompact: { gridTemplateColumns: '1fr', gap: 10 },
  compactList: { display: 'grid', gap: 10 },
  boardWrap: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' },
  boardWrapMobile: { gridTemplateColumns: '1fr', gap: 10 },
  boardColumn: { background: 'var(--shell-panel-alt)', border: '1px solid var(--shell-border)', borderRadius: 16, padding: 14, display: 'grid', gap: 12 },
  boardColumnMobile: { borderRadius: 14, padding: 10, gap: 10 },
  boardColumnHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  projectCard: { background: 'var(--shell-panel)', border: '1px solid var(--shell-border)', borderRadius: 14, padding: 14 },
  projectCardCompact: { borderRadius: 12, padding: 10 },
  infoCard: { background: 'var(--shell-panel)', color: 'var(--shell-text)', border: '1px solid var(--shell-border)', borderRadius: 16, padding: 18, textAlign: 'left', cursor: 'pointer', minWidth: 0, overflowWrap: 'anywhere' },
  infoCardCompact: { borderRadius: 12, padding: 12 },
  tabRail: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  tabRailCompact: { gap: 6 },
  tabButton: { background: 'var(--shell-panel-alt)', color: '#cbd5e1', border: '1px solid var(--shell-border)', borderRadius: 999, padding: '8px 12px', cursor: 'pointer' },
  tabButtonCompact: { padding: '7px 10px', fontSize: 12 },
  tabButtonActive: { background: 'linear-gradient(135deg, var(--shell-accent) 0%, var(--shell-accent-strong) 100%)', borderColor: 'var(--shell-accent-strong)', color: '#fff' },
  tagRail: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  buttonRail: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 },
  statCard: { background: 'var(--shell-panel)', border: '1px solid var(--shell-border)', borderRadius: 16, padding: 18, minWidth: 0, overflowWrap: 'anywhere' },
  statLabel: { color: 'var(--shell-muted)', marginBottom: 8, fontSize: 14 },
  statValue: { fontSize: 24, fontWeight: 700 },
  twoColumn: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  tableWrap: { overflowX: 'auto', background: 'var(--shell-panel)', border: '1px solid var(--shell-border)', borderRadius: 18 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', color: 'var(--shell-muted)', fontWeight: 600, padding: 14, borderBottom: '1px solid var(--shell-border)', whiteSpace: 'normal', overflowWrap: 'anywhere' },
  td: { padding: 14, borderBottom: '1px solid var(--shell-border)', verticalAlign: 'top', whiteSpace: 'normal', overflowWrap: 'anywhere' },
  tableLink: { background: 'transparent', border: 0, color: 'var(--shell-accent-soft)', padding: 0, cursor: 'pointer' },
  badge: { display: 'inline-block', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' },
  centerScreen: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--shell-bg)' },
  authCard: { width: 'min(640px, 100%)', background: 'linear-gradient(180deg, rgba(17,24,39,0.96) 0%, rgba(9,12,21,0.98) 100%)', border: '1px solid var(--shell-sidebar-border)', borderRadius: 24, padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,0.4)' },
  authBrandMark: { width: 58, height: 58, display: 'grid', placeItems: 'center', marginBottom: 14, borderRadius: 18, fontSize: 30, fontWeight: 800, color: '#ffe5d6', background: 'radial-gradient(circle at 35% 25%, var(--shell-accent-soft) 0%, var(--shell-accent) 34%, var(--shell-accent-strong) 62%, #281014 100%)', boxShadow: '0 18px 48px rgba(0,0,0,0.24)' },
  form: { display: 'grid', gap: 14 },
  field: { display: 'grid', gap: 8, minWidth: 0 },
  fieldLabel: { fontWeight: 600 },
  fieldHint: { color: 'var(--shell-muted)', fontSize: 13, lineHeight: 1.45, overflowWrap: 'anywhere' },
  fieldText: { fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' },
  input: { width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--shell-border)', background: 'var(--shell-panel-alt)', color: 'var(--shell-text)', minWidth: 0 },
  select: { width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--shell-border)', background: 'var(--shell-panel-alt)', color: 'var(--shell-text)', minWidth: 0 },
  primaryButton: { background: 'linear-gradient(135deg, var(--shell-accent) 0%, var(--shell-accent-strong) 100%)', color: '#fff7f3', border: 0, borderRadius: 12, padding: '12px 16px', cursor: 'pointer', fontWeight: 700, boxShadow: '0 14px 32px rgba(0,0,0,0.22)' },
  secondaryButton: { background: 'var(--shell-panel-alt)', color: 'var(--shell-text)', border: '1px solid var(--shell-border)', borderRadius: 12, padding: '10px 14px', cursor: 'pointer' },
  ghostButton: { background: 'transparent', color: 'var(--shell-accent-soft)', border: 0, cursor: 'pointer' },
  iconButton: { width: 42, height: 42, display: 'grid', placeItems: 'center', background: 'var(--shell-panel-alt)', color: 'var(--shell-text)', border: '1px solid var(--shell-border)', borderRadius: 12, cursor: 'pointer', flexShrink: 0 },
  muted: { color: 'var(--shell-muted)', lineHeight: 1.5, overflowWrap: 'anywhere' },
  list: { margin: 0, paddingLeft: 18, lineHeight: 1.8 },
  stack: { display: 'grid', gap: 10 },
  splitRow: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  rowLink: { background: 'var(--shell-panel-alt)', color: 'var(--shell-text)', border: '1px solid var(--shell-border)', borderRadius: 12, padding: 14, textAlign: 'left', cursor: 'pointer', minWidth: 0, overflowWrap: 'anywhere' },
  generatedPackageCard: { display: 'grid', gap: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--shell-border)', borderRadius: 14, padding: 14 },
  generatedPackageHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
  codeBlock: { margin: 0, padding: 12, borderRadius: 12, background: 'rgba(2,6,23,0.55)', border: '1px solid var(--shell-border)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.5 },
  inlineForm: { width: 'min(100%, 940px)', display: 'grid', gap: 14, minWidth: 0, background: 'var(--shell-panel)', border: '1px solid var(--shell-border)', borderRadius: 18, padding: '18px clamp(14px, 2vw, 22px)', boxShadow: '0 12px 30px rgba(0,0,0,0.16)' },
  formTitle: { fontSize: 16, lineHeight: 1.35, overflowWrap: 'anywhere' },
  formFieldsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'start' },
  formFooter: { display: 'grid', gap: 10 },
  inlineField: { display: 'grid', gap: 6, fontSize: 13, minWidth: 0 },
  inlineFieldWide: { gridColumn: '1 / -1' },
  inlineFieldCompact: { gap: 5, fontSize: 12 },
  banner: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', background: 'var(--shell-panel)', border: '1px solid var(--shell-border)', borderRadius: 14, padding: '12px 16px', marginBottom: 20 },
  errorText: { color: '#fca5a5' },
  okText: { color: '#86efac' },
  mobileTopBar: { display: 'none' },
  mobileTopBarVisible: { display: 'flex', position: 'sticky', top: 0, zIndex: 20, alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 0 18px', background: 'var(--shell-bg)' },
  mobileTopBarBrand: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  mobileTopBarLogo: { width: 44, height: 44, objectFit: 'contain', objectPosition: 'left center', background: 'transparent', borderRadius: 0, padding: 0, filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.22))' },
  mobileTopBarText: { minWidth: 0, display: 'grid' },
  mobileTopBarSubtle: { color: 'var(--shell-muted)', fontSize: 12, overflowWrap: 'anywhere' },
  mobileTopBarSpacer: { width: 42, height: 42 },
  settingsDrawerBackdrop: { position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', opacity: 0, pointerEvents: 'none', transition: 'opacity 180ms ease', zIndex: 29 },
  settingsDrawerBackdropVisible: { opacity: 1, pointerEvents: 'auto' },
  settingsDrawer: { position: 'fixed', top: 0, right: 0, width: 'min(520px, 100vw)', height: '100vh', padding: 18, background: 'var(--shell-bg-alt)', borderLeft: '1px solid var(--shell-border)', overflowY: 'auto', transform: 'translateX(104%)', transition: 'transform 200ms ease', zIndex: 30, boxShadow: '-20px 0 50px rgba(0,0,0,0.3)' },
  settingsDrawerOpen: { transform: 'translateX(0)' },
  settingsDrawerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  brandPreviewCard: { display: 'grid', gap: 10, background: 'linear-gradient(180deg, rgba(17,24,39,0.96), rgba(9,12,21,0.98))', backgroundSize: 'cover', backgroundPosition: 'center', border: '1px solid var(--shell-border)', borderRadius: 18, padding: 18 },
  uploadGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 },
  assetUploadPreview: { display: 'grid', gap: 8, justifyItems: 'start' },
  assetUploadImage: { maxWidth: '100%', maxHeight: 120, objectFit: 'contain', objectPosition: 'left center', borderRadius: 0, background: 'transparent', padding: 0 },
  inputCompact: { padding: '10px 12px', fontSize: 13 },
  selectCompact: { padding: '10px 12px', fontSize: 13 },
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const ensureResponsiveRules = () => {
    if (document.getElementById('aetnix-responsive-rules')) return;
    const style = document.createElement('style');
    style.id = 'aetnix-responsive-rules';
    style.textContent = `
      @media (max-width: 960px) {
        #root { min-height: 100vh; }
      }
      @media (max-width: 760px) {
        * { box-sizing: border-box; }
        table { min-width: 0 !important; }
        input, select, textarea, button { max-width: 100%; }
      }
    `;
    document.head.appendChild(style);
  };
  ensureResponsiveRules();
}


ReactDOM.createRoot(document.getElementById('root')).render(h(App));
