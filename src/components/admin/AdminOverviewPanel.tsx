import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarCheck,
  Car,
  IndianRupee,
  MessageSquare,
  RotateCcw,
  Users,
} from 'lucide-react';
import { formatINR } from '../../lib/api';
import type { AdminOverviewPayload, AdminTabKey } from './adminTypes';

interface AdminOverviewPanelProps {
  data: AdminOverviewPayload;
  onNavigateTab: (tab: AdminTabKey) => void;
}

const CHART_COLORS = ['#C8A24D', '#0B0B0D', '#5C5E6B', '#10B981', '#D97706'];

export const AdminOverviewPanel: React.FC<AdminOverviewPanelProps> = ({
  data,
  onNavigateTab,
}) => {
  const [dateWindow, setDateWindow] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [branchFilter, setBranchFilter] = useState<string>('all');

  const activeBranches = useMemo(
    () => (data.branches || []).filter((b) => b.active !== false),
    [data.branches]
  );

  const metrics = useMemo(() => {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const monthPrefix = now.toISOString().slice(0, 7);
    const sevenDaysAgoMs = now.getTime() - 7 * 86400000;
    const windowDays =
      dateWindow === '7d' ? 7 : dateWindow === '30d' ? 30 : dateWindow === '90d' ? 90 : null;
    const cutoffMs = windowDays ? now.getTime() - windowDays * 86400000 : 0;

    const inWindow = (iso?: string) => {
      if (!cutoffMs || !iso) return true;
      const t = new Date(iso).getTime();
      return Number.isFinite(t) && t >= cutoffMs;
    };

    const matchBranch = (branchId?: string) =>
      branchFilter === 'all' || !branchId || branchId === branchFilter;

    const allBookings = (data.bookings || []).filter((b) => matchBranch(b.branchId));
    const windowBookings = allBookings.filter((b) => inWindow(b.createdAt));

    const bookingBranchMap: Record<string, string> = {};
    for (const b of data.bookings || []) bookingBranchMap[b.id] = b.branchId;

    const vehicles = (data.vehicles || []).filter((v) => !v.archived && matchBranch(v.branchId));
    const customers = (data.users || []).filter((u) => u.role === 'customer');
    const staffMembers = (data.users || []).filter((u) => u.role !== 'customer');
    const payments = (data.payments || []).filter((p) => {
      const bBranch = bookingBranchMap[p.bookingId];
      return matchBranch(bBranch);
    });
    const proofs = (data.paymentProofs || []).filter((p) => {
      const bBranch = bookingBranchMap[p.bookingId];
      return matchBranch(bBranch);
    });
    const refunds = (data.refunds || []).filter((r) => matchBranch(r.branchId));
    const kycQueue = (data.kycQueue || []).filter((k) => matchBranch(k.branchId));

    const totalBookings = windowBookings.length;
    const todaysBookings = allBookings.filter((b) => (b.createdAt || '').startsWith(todayKey)).length;
    const upcomingBookings = allBookings.filter(
      (b) =>
        ['Confirmed', 'KYC Verified', 'Ready for Pickup'].includes(b.status) &&
        new Date(b.startDate).getTime() >= now.getTime()
    ).length;
    const activeRentals = allBookings.filter((b) => b.status === 'Active Rental').length;
    const completedBookings = windowBookings.filter((b) => b.status === 'Completed').length;
    const pendingApprovals = allBookings.filter((b) =>
      ['Pending Approval', 'Payment Verification', 'Pending Payment'].includes(b.status)
    ).length;
    const cancelledBookings = windowBookings.filter((b) =>
      ['Cancelled', 'Rejected'].includes(b.status)
    ).length;

    const totalCustomers = customers.length;
    const newCustomers = customers.filter(
      (c) => new Date(c.createdAt || 0).getTime() >= sevenDaysAgoMs
    ).length;

    const totalVehicles = vehicles.length;
    const distinctModelKeys = new Set(
      vehicles.map((v) => v.modelKey || `${v.brand}-${v.model || v.name}`.toLowerCase())
    );
    const totalVehicleModels = distinctModelKeys.size;
    const availableVehicles = vehicles.filter((v) => v.status === 'Available').length;
    const reservedVehicles = vehicles.filter((v) => v.status === 'Reserved').length;
    const rentedVehicles = vehicles.filter((v) =>
      ['Rented', 'Active Rental'].includes(v.status)
    ).length;
    const bookedVehicles = reservedVehicles + rentedVehicles;
    const maintenanceVehicles = vehicles.filter((v) =>
      ['Maintenance', 'Under Maintenance', 'Inspection'].includes(v.status)
    ).length;

    const pendingPaymentsCount = proofs.filter(
      (p) => p.status === 'Pending Verification'
    ).length;
    const verifiedPaymentsList = payments.filter((p) => p.status === 'Paid');
    const windowPayments = verifiedPaymentsList.filter((p) => inWindow(p.createdAt));

    const totalRevenue = windowPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const todaysRevenue = verifiedPaymentsList
      .filter((p) => (p.createdAt || '').startsWith(todayKey))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const monthlyRevenue = verifiedPaymentsList
      .filter((p) => (p.createdAt || '').startsWith(monthPrefix))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const outstandingBalances = allBookings
      .filter((b) => !['Cancelled', 'Rejected', 'Refunded', 'Completed'].includes(b.status))
      .reduce((sum, b) => sum + Number(b.pricing?.balanceDueAtPickup || 0), 0);

    const pendingRefundRequests = refunds.filter(
      (r) => r.status === 'Pending' || r.status === 'Processing'
    ).length;
    const pendingKycCount = kycQueue.filter((k) =>
      ['Pending', 'Under Review'].includes(k.status)
    ).length;

    const activeCoupons = (data.coupons || []).filter((c) => c.active).length;
    const activeOffers = (data.offers || []).filter((o) => o.active).length;

    // Daily velocity chart
    const chartDays = dateWindow === '7d' ? 7 : 14;
    const dailyMap: Record<string, { day: string; bookings: number; revenue: number }> = {};
    for (let i = chartDays - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      dailyMap[iso] = { day: label, bookings: 0, revenue: 0 };
    }
    for (const b of allBookings) {
      const key = (b.createdAt || '').slice(0, 10);
      if (dailyMap[key]) dailyMap[key].bookings += 1;
    }
    for (const p of verifiedPaymentsList) {
      const key = (p.createdAt || '').slice(0, 10);
      if (dailyMap[key]) dailyMap[key].revenue += Number(p.amount || 0);
    }

    // Weekly vs Monthly Revenue Comparison (4 weeks)
    const weeklyComparison: { period: string; revenue: number; bookings: number }[] = [];
    for (let w = 3; w >= 0; w--) {
      const endMs = now.getTime() - w * 7 * 86400000;
      const startMs = endMs - 7 * 86400000;
      const wRev = verifiedPaymentsList
        .filter((p) => {
          const t = new Date(p.createdAt || 0).getTime();
          return t >= startMs && t < endMs;
        })
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const wBk = allBookings.filter((b) => {
        const t = new Date(b.createdAt || 0).getTime();
        return t >= startMs && t < endMs;
      }).length;
      weeklyComparison.push({
        period: w === 0 ? 'This Week' : `${w}w Ago`,
        revenue: wRev,
        bookings: wBk,
      });
    }

    const fleetStatusBreakdown = [
      { name: 'Available', value: availableVehicles },
      { name: 'Reserved', value: reservedVehicles },
      { name: 'Rented / Active', value: rentedVehicles },
      { name: 'Maintenance', value: maintenanceVehicles },
    ].filter((x) => x.value > 0);

    const utilizationByCategory: Record<string, { category: string; total: number; booked: number }> = {};
    for (const v of vehicles) {
      if (!utilizationByCategory[v.category]) {
        utilizationByCategory[v.category] = { category: v.category, total: 0, booked: 0 };
      }
      utilizationByCategory[v.category].total += 1;
      if (['Reserved', 'Rented', 'Active Rental'].includes(v.status)) {
        utilizationByCategory[v.category].booked += 1;
      }
    }

    // Branch performance summary
    const branchPerf = activeBranches.map((br) => {
      const brVehicles = (data.vehicles || []).filter((v) => !v.archived && v.branchId === br.id);
      const brBookings = (data.bookings || []).filter((b) => b.branchId === br.id && inWindow(b.createdAt));
      const brBookingIds = new Set(
        (data.bookings || []).filter((b) => b.branchId === br.id).map((b) => b.id)
      );
      const brRevenue = (data.payments || [])
        .filter((p) => p.status === 'Paid' && brBookingIds.has(p.bookingId) && inWindow(p.createdAt))
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      return {
        id: br.id,
        name: br.name,
        cityName: br.cityName,
        units: brVehicles.length,
        availableUnits: brVehicles.filter((v) => v.status === 'Available').length,
        bookings: brBookings.length,
        activeRentals: brBookings.filter((b) => b.status === 'Active Rental').length,
        revenue: brRevenue,
      };
    });

    return {
      totalBookings,
      todaysBookings,
      upcomingBookings,
      activeRentals,
      completedBookings,
      pendingApprovals,
      cancelledBookings,
      totalCustomers,
      newCustomers,
      totalStaff: staffMembers.length,
      totalVehicles,
      totalVehicleModels,
      availableVehicles,
      reservedVehicles,
      rentedVehicles,
      bookedVehicles,
      maintenanceVehicles,
      pendingPaymentsCount,
      pendingRefundRequests,
      pendingKycCount,
      totalRevenue,
      todaysRevenue,
      monthlyRevenue,
      outstandingBalances,
      activeCoupons,
      activeOffers,
      trendData: Object.values(dailyMap),
      weeklyComparison,
      fleetStatusBreakdown,
      categoryUtilization: Object.values(utilizationByCategory),
      branchPerf,
    };
  }, [data, dateWindow, branchFilter, activeBranches]);

  const kpiCards = [
    { label: 'Total Vehicles (Models)', value: metrics.totalVehicleModels, accent: false },
    { label: 'Total Physical Cars', value: metrics.totalVehicles, accent: false },
    { label: 'Available Cars', value: metrics.availableVehicles, accent: false },
    { label: 'Booked Cars', value: metrics.bookedVehicles, accent: false },
    { label: 'Active Rentals', value: metrics.activeRentals, accent: true },
    { label: 'Pending Bookings', value: metrics.pendingApprovals, accent: metrics.pendingApprovals > 0 },
    { label: 'Pending Payments', value: metrics.pendingPaymentsCount, accent: metrics.pendingPaymentsCount > 0 },
    { label: 'Pending Doc Verification', value: metrics.pendingKycCount, accent: metrics.pendingKycCount > 0 },
    { label: 'Total Customers', value: metrics.totalCustomers, accent: false },
    { label: 'Revenue (Filtered)', value: formatINR(metrics.totalRevenue), accent: true },
    { label: "Today's Revenue", value: formatINR(metrics.todaysRevenue), accent: false },
    { label: 'Monthly Revenue', value: formatINR(metrics.monthlyRevenue), accent: false },
    { label: 'Outstanding Balances', value: formatINR(metrics.outstandingBalances), accent: false },
    { label: 'Total Bookings', value: metrics.totalBookings, accent: false },
    { label: "Today's Bookings", value: metrics.todaysBookings, accent: false },
    { label: 'Upcoming Reservations', value: metrics.upcomingBookings, accent: false },
    { label: 'Cancelled / Rejected', value: metrics.cancelledBookings, accent: false },
    { label: 'Under Maintenance', value: metrics.maintenanceVehicles, accent: metrics.maintenanceVehicles > 0 },
    { label: 'Refund Requests', value: metrics.pendingRefundRequests, accent: metrics.pendingRefundRequests > 0 },
    { label: 'New Customers (7d) · Staff', value: `${metrics.newCustomers} · ${metrics.totalStaff}`, accent: false },
  ];

  const openEnquiriesCount = (data.enquiries || []).filter((e) => e.status === 'New').length;
  const openRoadsideCount = (data.roadsideRequests || []).filter((r) => r.status !== 'Resolved').length;

  return (
    <div className="space-y-6">
      {/* Executive Filter Bar */}
      <div className="bg-white border border-black/10 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Executive Control Overview</h2>
          <p className="text-slate-muted">Live metrics calculated from verified database collections.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex rounded-lg border border-black/15 overflow-hidden bg-alabaster">
            {([
              ['7d', '7 Days'],
              ['30d', '30 Days'],
              ['90d', '90 Days'],
              ['all', 'All Time'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDateWindow(key)}
                className={`px-3 py-1.5 font-semibold cursor-pointer transition-colors ${
                  dateWindow === key
                    ? 'bg-obsidian text-gold'
                    : 'text-slate-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="px-3 py-1.5 border border-black/15 rounded-lg bg-white font-semibold"
          >
            <option value="all">All Accessible Branches ({activeBranches.length})</option>
            {activeBranches.map((br) => (
              <option key={br.id} value={br.id}>
                {br.name} ({br.cityName})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 20 Live Backend KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-3.5">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className={`rounded-xl p-4 border ${
              card.accent
                ? 'bg-obsidian text-white border-gold/40'
                : 'bg-white text-ink border-black/10'
            }`}
          >
            <p className={`text-[11px] font-medium ${card.accent ? 'text-white/65' : 'text-slate-muted'}`}>
              {card.label}
            </p>
            <p
              className={`font-mono tabular-nums text-xl sm:text-2xl font-semibold mt-1 ${
                card.accent ? 'text-gold' : 'text-ink'
              }`}
            >
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Pending Operational Tasks & WhatsApp / Integrations Dispatch Status */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-black/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Pending Operational Tasks</h2>
            <span className="font-mono text-xs text-slate-muted">Live Queue</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <button
              type="button"
              onClick={() => onNavigateTab('payment_settings')}
              className="p-3.5 rounded-xl bg-alabaster border border-black/10 hover:border-gold flex items-center justify-between text-left cursor-pointer"
            >
              <div>
                <p className="font-semibold text-ink">Verify UPI Proofs & Refunds</p>
                <p className="text-slate-muted mt-0.5">
                  {metrics.pendingPaymentsCount} proofs · {metrics.pendingRefundRequests} refunds
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-gold-hover shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('bookings')}
              className="p-3.5 rounded-xl bg-alabaster border border-black/10 hover:border-gold flex items-center justify-between text-left cursor-pointer"
            >
              <div>
                <p className="font-semibold text-ink">Booking Approvals & Handovers</p>
                <p className="text-slate-muted mt-0.5">{metrics.pendingApprovals} pending decision</p>
              </div>
              <ArrowRight className="w-4 h-4 text-gold-hover shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('kyc')}
              className="p-3.5 rounded-xl bg-alabaster border border-black/10 hover:border-gold flex items-center justify-between text-left cursor-pointer"
            >
              <div>
                <p className="font-semibold text-ink">Document Verification Queue</p>
                <p className="text-slate-muted mt-0.5">{metrics.pendingKycCount} submitted for review</p>
              </div>
              <ArrowRight className="w-4 h-4 text-gold-hover shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('notifications')}
              className="p-3.5 rounded-xl bg-alabaster border border-black/10 hover:border-gold flex items-center justify-between text-left cursor-pointer"
            >
              <div>
                <p className="font-semibold text-ink">Website Enquiries & Roadside</p>
                <p className="text-slate-muted mt-0.5">
                  {openEnquiriesCount} new enquiries · {openRoadsideCount} active dispatch
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-gold-hover shrink-0" />
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 bg-obsidian text-white border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-gold" />
              <h2 className="font-display text-xl font-semibold">Promotions & Dispatch Pulse</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('notifications')}
              className="text-xs text-gold hover:underline cursor-pointer"
            >
              Notifications
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums">
            <div className="p-3 rounded-lg bg-charcoal border border-white/10">
              <p className="text-white/60 text-[11px]">Active Offers</p>
              <p className="text-lg font-semibold text-gold mt-0.5">
                {metrics.activeOffers}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-charcoal border border-white/10">
              <p className="text-white/60 text-[11px]">Active Coupons</p>
              <p className="text-lg font-semibold text-emerald-400 mt-0.5">
                {metrics.activeCoupons}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-charcoal border border-white/10">
              <p className="text-white/60 text-[11px]">Branches Live</p>
              <p className="text-lg font-semibold text-white mt-0.5">
                {activeBranches.length}
              </p>
            </div>
          </div>

          <div className="space-y-1.5 text-[11px] text-white/75">
            {(data.whatsappSummary?.recentLogs || []).slice(0, 3).map((log) => (
              <div key={log.id} className="flex items-center justify-between gap-2 py-1 border-t border-white/10">
                <span className="font-mono truncate">{log.templateName}</span>
                <span className="shrink-0 text-gold">{log.deliveryStatus}</span>
              </div>
            ))}
            {(data.whatsappSummary?.recentLogs || []).length === 0 && (
              <p className="text-white/50">No recent outbound dispatch events recorded.</p>
            )}
          </div>
        </div>
      </div>

      {/* Charts Row: Daily Velocity + Weekly Revenue Comparison + Fleet Utilization */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-black/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold">Revenue & Booking Velocity</h2>
              <p className="text-xs text-slate-muted">Daily settled collections vs reservations</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('reports')}
              className="text-xs font-semibold text-gold-hover hover:underline cursor-pointer"
            >
              Analytics →
            </button>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar yAxisId="left" dataKey="revenue" name="Revenue (INR)" fill="#C8A24D" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="bookings" name="Bookings" fill="#0B0B0D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white border border-black/10 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-display text-lg font-semibold">4-Week Revenue Comparison</h2>
            <p className="text-xs text-slate-muted">Week-over-week realized payment volume</p>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.weeklyComparison}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="revenue" name="Weekly Revenue (INR)" fill="#0B0B0D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-3 bg-white border border-black/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold">Fleet Split</h2>
              <p className="text-xs text-slate-muted">Live unit readiness</p>
            </div>
            <span className="font-mono text-xs text-slate-muted">{metrics.totalVehicles} Units</span>
          </div>
          {metrics.fleetStatusBreakdown.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-slate-muted">
              No active fleet vehicles yet.
            </div>
          ) : (
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics.fleetStatusBreakdown}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={42}
                    outerRadius={70}
                    paddingAngle={3}
                  >
                    {metrics.fleetStatusBreakdown.map((entry, idx) => (
                      <Cell key={entry.name} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex flex-wrap gap-2.5 text-[11px] justify-center">
            {metrics.fleetStatusBreakdown.map((entry, idx) => (
              <span key={entry.name} className="inline-flex items-center gap-1 font-mono">
                <span
                  className="w-2.5 h-2.5 rounded-sm inline-block"
                  style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                />
                {entry.name}: {entry.value}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Branch Performance & Recent Staff Activity */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gold-hover" />
              Branch Performance Matrix
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('branches')}
              className="text-xs text-gold-hover hover:underline cursor-pointer"
            >
              Manage Branches
            </button>
          </div>
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black/10 text-[11px] uppercase text-slate-muted">
                  <th className="py-2 pr-3">Branch Hub</th>
                  <th className="py-2 pr-3">Fleet (Avail/Total)</th>
                  <th className="py-2 pr-3">Bookings</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 text-right">Realized Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10 font-mono tabular-nums">
                {metrics.branchPerf.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2.5 pr-3 font-sans">
                      <p className="font-semibold text-ink">{b.name}</p>
                      <p className="text-[11px] text-slate-muted">{b.cityName}</p>
                    </td>
                    <td className="py-2.5 pr-3">{b.availableUnits} / {b.units}</td>
                    <td className="py-2.5 pr-3">{b.bookings}</td>
                    <td className="py-2.5 pr-3 text-gold-hover font-semibold">{b.activeRentals}</td>
                    <td className="py-2.5 text-right font-semibold">{formatINR(b.revenue)}</td>
                  </tr>
                ))}
                {metrics.branchPerf.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center font-sans text-slate-muted">
                      No active branches configured.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-gold-hover" />
              Recent Staff Activity
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('staff')}
              className="text-xs text-gold-hover hover:underline cursor-pointer"
            >
              Staff Directory
            </button>
          </div>
          <div className="divide-y divide-black/10 text-xs">
            {(data.auditLogs || []).slice(0, 5).map((log) => (
              <div key={log.id} className="py-2.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono font-semibold text-ink truncate">
                    {log.action} <span className="font-normal text-slate-muted">· {log.actorName || log.actorRole}</span>
                  </p>
                  <p className="text-[11px] text-slate-muted truncate">{log.details}</p>
                </div>
                <span className="font-mono text-[10px] text-slate-muted shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
            {(data.auditLogs || []).length === 0 && (
              <p className="py-4 text-slate-muted">No staff activity recorded yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Bookings, Recent Customers, Recent Verified Payments */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-gold-hover" />
              Recent Bookings
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('bookings')}
              className="text-xs text-gold-hover hover:underline cursor-pointer"
            >
              View All
            </button>
          </div>
          <div className="divide-y divide-black/10 text-xs">
            {(data.bookings || []).slice(0, 5).map((b) => (
              <div key={b.id} className="py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink truncate">{b.vehicleName}</p>
                  <p className="text-slate-muted truncate">
                    {b.bookingReference} · {b.customerName}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono font-semibold">{formatINR(b.pricing?.totalPayable || 0)}</p>
                  <p className="text-[11px] text-gold-hover">{b.status}</p>
                </div>
              </div>
            ))}
            {(data.bookings || []).length === 0 && (
              <p className="py-4 text-slate-muted">No bookings recorded yet.</p>
            )}
          </div>
        </div>

        <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-gold-hover" />
              Recent Customers
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('customers')}
              className="text-xs text-gold-hover hover:underline cursor-pointer"
            >
              Directory
            </button>
          </div>
          <div className="divide-y divide-black/10 text-xs">
            {(data.users || [])
              .filter((u) => u.role === 'customer')
              .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
              .slice(0, 5)
              .map((u) => (
                <div key={u.uid} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">{u.displayName}</p>
                    <p className="font-mono text-[11px] text-slate-muted truncate">
                      {u.phone || u.email || '—'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-semibold text-ink">{u.kycStatus}</p>
                    <p className="text-[10px] text-slate-muted">{u.accountStatus}</p>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-gold-hover" />
              Recent Payments & Refunds
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('payment_settings')}
              className="text-xs text-gold-hover hover:underline cursor-pointer"
            >
              Finance Desk
            </button>
          </div>
          <div className="divide-y divide-black/10 text-xs">
            {(data.payments || []).slice(0, 4).map((p) => (
              <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono font-semibold text-ink truncate">{p.bookingReference}</p>
                  <p className="font-mono text-[11px] text-slate-muted truncate">
                    {p.method} · {p.gatewayRef}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono font-semibold text-emerald-700">
                    {formatINR(p.amount)}
                  </p>
                  <p className="text-[11px] text-slate-muted">{p.status}</p>
                </div>
              </div>
            ))}
            {(data.refunds || []).slice(0, 2).map((rf) => (
              <div key={rf.id} className="py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-ink truncate">{rf.bookingReference}</p>
                    <p className="text-[11px] text-slate-muted truncate">{rf.type.replace(/_/g, ' ')}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono font-semibold text-amber-700">-{formatINR(rf.amount)}</p>
                  <p className="text-[11px] text-slate-muted">{rf.status}</p>
                </div>
              </div>
            ))}
            {(data.payments || []).length === 0 && (data.refunds || []).length === 0 && (
              <p className="py-4 text-slate-muted">No financial transactions logged yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Category Utilization Summary */}
      <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Car className="w-4 h-4 text-gold-hover" />
          <h3 className="font-display text-lg font-semibold">Category Fleet Readiness</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 text-xs">
          {metrics.categoryUtilization.map((cat) => (
            <div key={cat.category} className="p-3 rounded-lg bg-alabaster border border-black/10">
              <p className="font-semibold text-ink">{cat.category}</p>
              <p className="font-mono tabular-nums text-slate-muted mt-1">
                {cat.booked}/{cat.total} booked
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
