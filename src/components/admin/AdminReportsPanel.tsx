import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, FileText } from 'lucide-react';
import { formatINR, getSessionToken } from '../../lib/api';
import { auth } from '../../lib/firebase';
import { downloadAnalyticsReportPdf } from '../../lib/pdfExport';
import { hasAdminPermission } from '../../lib/permissions';
import type { CustomRole, UserProfile } from '../../types';
import type { AdminOverviewPayload } from './adminTypes';

interface AdminReportsPanelProps {
  profile: UserProfile;
  roles?: CustomRole[];
  data: AdminOverviewPayload;
}

type ReportCategory =
  | 'revenue'
  | 'bookings'
  | 'collections'
  | 'refunds'
  | 'balances'
  | 'utilization'
  | 'branch_performance'
  | 'customers'
  | 'coupons'
  | 'offers'
  | 'cancellations'
  | 'staff_activity';

export const AdminReportsPanel: React.FC<AdminReportsPanelProps> = ({
  profile,
  roles,
  data,
}) => {
  const canExport =
    profile.role === 'super_admin' || hasAdminPermission(profile, 'export_reports', roles);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [branchFilter, setBranchFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [reportTab, setReportTab] = useState<ReportCategory>('revenue');

  const inRange = (iso?: string) => {
    if (!iso) return true;
    const ms = new Date(iso).getTime();
    if (startDate && ms < new Date(startDate).getTime()) return false;
    if (endDate && ms > new Date(`${endDate}T23:59:59Z`).getTime()) return false;
    return true;
  };

  const summary = useMemo(() => {
    const matchBranch = (bId?: string) => branchFilter === 'All' || !bId || bId === branchFilter;
    const bookingBranchMap: Record<string, string> = {};
    for (const b of data.bookings || []) bookingBranchMap[b.id] = b.branchId;

    const bookings = (data.bookings || []).filter(
      (b) =>
        inRange(b.createdAt) &&
        matchBranch(b.branchId) &&
        (statusFilter === 'All' || b.status === statusFilter)
    );
    const payments = (data.payments || []).filter(
      (p) => inRange(p.createdAt) && matchBranch(bookingBranchMap[p.bookingId])
    );
    const refunds = (data.refunds || []).filter(
      (r) => inRange(r.createdAt) && matchBranch(r.branchId)
    );
    const customers = (data.users || []).filter((u) => u.role === 'customer' && inRange(u.createdAt));
    const vehicles = (data.vehicles || []).filter((v) => !v.archived && matchBranch(v.branchId));
    const logs = (data.auditLogs || []).filter(
      (l) => inRange(l.timestamp) && matchBranch(l.branchId)
    );

    const totalRevenue = payments
      .filter((p) => p.status === 'Paid')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const pendingBalance = bookings
      .filter((b) => !['Cancelled', 'Rejected', 'Refunded', 'Completed'].includes(b.status))
      .reduce((s, b) => s + Number(b.pricing?.balanceDueAtPickup || 0), 0);
    const refundedTotal = refunds
      .filter((r) => r.status === 'Processed')
      .reduce((s, r) => s + Number(r.amount || 0), 0);

    const cancelledList = bookings.filter((b) => ['Cancelled', 'Rejected'].includes(b.status));
    const cancellationRate =
      bookings.length > 0 ? Math.round((cancelledList.length / bookings.length) * 100) : 0;

    // Revenue by Category
    const revByCat: Record<string, { name: string; revenue: number; bookings: number }> = {};
    for (const b of bookings) {
      if (['Cancelled', 'Rejected'].includes(b.status)) continue;
      if (!revByCat[b.vehicleCategory]) {
        revByCat[b.vehicleCategory] = { name: b.vehicleCategory, revenue: 0, bookings: 0 };
      }
      revByCat[b.vehicleCategory].revenue += Number(b.pricing?.totalRentalWithTax || 0);
      revByCat[b.vehicleCategory].bookings += 1;
    }

    // Weekly Revenue Comparison (Last 4 weeks)
    const nowMs = Date.now();
    const weeklyData: { week: string; revenue: number; bookings: number }[] = [];
    for (let w = 3; w >= 0; w--) {
      const endMs = nowMs - w * 7 * 86400000;
      const startMs = endMs - 7 * 86400000;
      const wRev = payments
        .filter((p) => {
          if (p.status !== 'Paid') return false;
          const t = new Date(p.createdAt).getTime();
          return t >= startMs && t < endMs;
        })
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const wBk = bookings.filter((b) => {
        const t = new Date(b.createdAt).getTime();
        return t >= startMs && t < endMs;
      }).length;
      weeklyData.push({
        week: w === 0 ? 'Current 7d' : `Week -${w}`,
        revenue: wRev,
        bookings: wBk,
      });
    }

    const branchPerf = (data.branches || []).map((br) => {
      const brBookings = (data.bookings || []).filter(
        (b) => b.branchId === br.id && inRange(b.createdAt)
      );
      const brUnits = (data.vehicles || []).filter((v) => !v.archived && v.branchId === br.id).length;
      const brBookingIds = new Set(
        (data.bookings || []).filter((b) => b.branchId === br.id).map((b) => b.id)
      );
      const brRev = (data.payments || [])
        .filter((p) => p.status === 'Paid' && brBookingIds.has(p.bookingId) && inRange(p.createdAt))
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      return {
        name: br.name,
        city: br.cityName,
        units: brUnits,
        bookings: brBookings.length,
        revenue: brRev,
      };
    });

    const couponStats = (data.coupons || []).map((c) => {
      const matched = bookings.filter((b) => b.pricing?.couponCode === c.code);
      return {
        code: c.code,
        uses: matched.length,
        discountTotal: matched.reduce((s, b) => s + Number(b.pricing?.couponDiscount || 0), 0),
        active: c.active ? 'Active' : 'Paused',
      };
    });

    const offerStats = (data.offers || []).map((o) => {
      const camp = (data.campaigns || []).filter((c) => c.offerId === o.id);
      return {
        title: o.title,
        coupon: o.couponCode || '—',
        campaigns: camp.length,
        delivered: camp.reduce((s, c) => s + c.deliveredCount, 0),
      };
    });

    const vehicleStats = vehicles.map((v) => {
      const vBk = bookings.filter((b) => b.vehicleId === v.id && !['Cancelled', 'Rejected'].includes(b.status));
      return {
        name: v.name,
        category: v.category,
        status: v.status,
        trips: vBk.length,
        gross: vBk.reduce((s, b) => s + Number(b.pricing?.totalRentalWithTax || 0), 0),
      };
    });

    return {
      bookings,
      payments,
      refunds,
      customers,
      vehicles,
      logs,
      totalRevenue,
      pendingBalance,
      refundedTotal,
      cancelledList,
      cancellationRate,
      revByCat: Object.values(revByCat),
      weeklyData,
      branchPerf,
      couponStats,
      offerStats,
      vehicleStats,
    };
  }, [data, startDate, endDate, branchFilter, statusFilter]);

  const handleServerCsv = async (type: 'bookings' | 'payments' | 'refunds') => {
    try {
      const token = getSessionToken() || (auth.currentUser ? await auth.currentUser.getIdToken() : '');
      const params = new URLSearchParams();
      if (branchFilter !== 'All') params.set('branchId', branchFilter);
      if (type === 'bookings' && statusFilter !== 'All') params.set('status', statusFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const res = await fetch(`/api/admin/export/${type}?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export failed');
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `elitedrive-${type}-report.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('CSV report downloaded');
    } catch {
      toast.error('CSV export failed');
    }
  };

  const handleCurrentViewPdf = () => {
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    let title = 'Analytics Report';

    if (reportTab === 'revenue' || reportTab === 'bookings') {
      title = 'Bookings & Revenue Summary';
      headers = ['Ref', 'Customer', 'Vehicle', 'Rental Total', 'Due Now', 'Balance', 'Payment', 'Status'];
      rows = summary.bookings.map((b) => [
        b.bookingReference,
        b.customerName,
        b.vehicleName,
        `INR ${Math.round(b.pricing?.totalPayable || 0)}`,
        `INR ${Math.round(b.pricing?.amountDueNow || 0)}`,
        `INR ${Math.round(b.pricing?.balanceDueAtPickup || 0)}`,
        b.paymentStatus,
        b.status,
      ]);
    } else if (reportTab === 'collections') {
      title = 'Payment Collection Report';
      headers = ['Booking Ref', 'Method', 'UTR / Gateway Ref', 'Amount', 'Status', 'Date'];
      rows = summary.payments.map((p) => [
        p.bookingReference,
        p.method,
        p.gatewayRef,
        `INR ${Math.round(p.amount)}`,
        p.status,
        new Date(p.createdAt).toLocaleDateString('en-IN'),
      ]);
    } else if (reportTab === 'refunds') {
      title = 'Refund & Deposit Settlement Report';
      headers = ['Booking Ref', 'Customer', 'Type', 'Amount', 'Status', 'Reference'];
      rows = summary.refunds.map((r) => [
        r.bookingReference,
        r.customerName,
        r.type,
        `INR ${Math.round(r.amount)}`,
        r.status,
        r.refundReference || '—',
      ]);
    } else if (reportTab === 'branch_performance') {
      title = 'Branch Performance Comparison';
      headers = ['Branch', 'City', 'Fleet Units', 'Bookings', 'Revenue'];
      rows = summary.branchPerf.map((b) => [
        b.name,
        b.city,
        b.units,
        b.bookings,
        `INR ${Math.round(b.revenue)}`,
      ]);
    } else if (reportTab === 'utilization') {
      title = 'Vehicle Utilization Report';
      headers = ['Vehicle', 'Category', 'Current Status', 'Completed/Active Trips', 'Gross Rental'];
      rows = summary.vehicleStats.map((v) => [v.name, v.category, v.status, v.trips, `INR ${Math.round(v.gross)}`]);
    } else if (reportTab === 'coupons') {
      title = 'Coupon Usage Report';
      headers = ['Code', 'Status', 'Applied Bookings', 'Total Discount'];
      rows = summary.couponStats.map((c) => [c.code, c.active, c.uses, `INR ${Math.round(c.discountTotal)}`]);
    } else if (reportTab === 'staff_activity') {
      title = 'Employee Activity Audit Report';
      headers = ['Timestamp', 'Role', 'Action', 'Target', 'Details'];
      rows = summary.logs.slice(0, 60).map((l) => [
        new Date(l.timestamp).toLocaleString('en-IN'),
        l.actorRole,
        l.action,
        `${l.targetType}:${l.targetId}`,
        l.details,
      ]);
    } else {
      title = 'Customer & Balance Report';
      headers = ['Customer', 'Phone', 'KYC', 'Account', 'Joined'];
      rows = summary.customers.map((c) => [
        c.displayName,
        c.phone || '—',
        c.kycStatus,
        c.accountStatus,
        new Date(c.createdAt).toLocaleDateString('en-IN'),
      ]);
    }

    downloadAnalyticsReportPdf({
      title,
      subtitle: `${startDate || 'All time'} to ${endDate || 'Present'} · Branch: ${branchFilter}`,
      headers,
      rows,
      filename: `elitedrive-${reportTab}-report.pdf`,
      settings: data.settings,
    });
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Date, Branch & Export Controls */}
      <div className="bg-white border border-black/10 rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-slate-muted mb-0.5">Branch Hub</label>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-1.5 border border-black/15 rounded-lg bg-white"
            >
              <option value="All">All Branches</option>
              {(data.branches || []).map((br) => (
                <option key={br.id} value={br.id}>{br.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-muted mb-0.5">Booking Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 border border-black/15 rounded-lg bg-white"
            >
              <option value="All">All Statuses</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Active Rental">Active Rental</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-muted mb-0.5">From Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 border border-black/15 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-muted mb-0.5">To Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 border border-black/15 rounded-lg font-mono"
            />
          </div>
        </div>

        {canExport && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleServerCsv('bookings')}
              className="px-3 py-2 border border-black/15 rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-gold-hover" />
              Bookings CSV
            </button>
            <button
              type="button"
              onClick={() => void handleServerCsv('payments')}
              className="px-3 py-2 border border-black/15 rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-gold-hover" />
              Payments CSV
            </button>
            <button
              type="button"
              onClick={() => void handleServerCsv('refunds')}
              className="px-3 py-2 border border-black/15 rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-gold-hover" />
              Refunds CSV
            </button>
            <button
              type="button"
              onClick={handleCurrentViewPdf}
              className="px-3.5 py-2 bg-obsidian text-white rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-gold" />
              Download Active PDF
            </button>
          </div>
        )}
      </div>

      {/* Top Executive Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
        <div className="bg-obsidian text-white rounded-xl p-4">
          <p className="text-white/60">Collected Revenue</p>
          <p className="font-mono text-xl font-semibold text-gold mt-1">{formatINR(summary.totalRevenue)}</p>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <p className="text-slate-muted">Bookings in Window</p>
          <p className="font-mono text-xl font-semibold text-ink mt-1">{summary.bookings.length}</p>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <p className="text-slate-muted">Outstanding Pickup Bal</p>
          <p className="font-mono text-xl font-semibold text-ink mt-1">{formatINR(summary.pendingBalance)}</p>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <p className="text-slate-muted">Processed Refunds</p>
          <p className="font-mono text-xl font-semibold text-amber-700 mt-1">{formatINR(summary.refundedTotal)}</p>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <p className="text-slate-muted">Customer Signups</p>
          <p className="font-mono text-xl font-semibold text-ink mt-1">{summary.customers.length}</p>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <p className="text-slate-muted">Cancellation Rate</p>
          <p className="font-mono text-xl font-semibold text-ink mt-1">{summary.cancellationRate}%</p>
        </div>
      </div>

      {/* Category Switcher */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['revenue', 'Revenue Summary'],
            ['bookings', 'Booking Summary'],
            ['collections', 'Payment Collection'],
            ['refunds', 'Refunds & Deposits'],
            ['balances', 'Outstanding Balances'],
            ['utilization', 'Vehicle Utilization'],
            ['branch_performance', 'Branch Performance'],
            ['customers', 'Customer Growth'],
            ['coupons', 'Coupon Usage'],
            ['offers', 'Offer Performance'],
            ['cancellations', 'Cancellation Analysis'],
            ['staff_activity', 'Employee Activity'],
          ] as [ReportCategory, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setReportTab(key)}
            className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
              reportTab === key
                ? 'bg-obsidian text-white'
                : 'bg-white border border-black/15 text-ink hover:border-gold'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
          <h3 className="font-display text-xl font-semibold">Category Revenue & Demand</h3>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.revByCat}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="revenue" name="Gross Rental (INR)" fill="#C8A24D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
          <h3 className="font-display text-xl font-semibold">Weekly Revenue Comparison (4 Weeks)</h3>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="revenue" name="Collected Revenue (INR)" fill="#0B0B0D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tabular Breakdown for Selected Report */}
      <div className="bg-white border border-black/10 rounded-xl p-5 overflow-x-auto">
        {reportTab === 'utilization' && (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/10 text-[11px] uppercase text-slate-muted">
                <th className="py-2">Vehicle</th>
                <th className="py-2">Category</th>
                <th className="py-2">Status</th>
                <th className="py-2">Bookings</th>
                <th className="py-2 text-right">Gross Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {summary.vehicleStats.map((v) => (
                <tr key={v.name}>
                  <td className="py-2.5 font-semibold">{v.name}</td>
                  <td className="py-2.5">{v.category}</td>
                  <td className="py-2.5">{v.status}</td>
                  <td className="py-2.5 font-mono">{v.trips}</td>
                  <td className="py-2.5 font-mono text-right">{formatINR(v.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {reportTab === 'branch_performance' && (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/10 text-[11px] uppercase text-slate-muted">
                <th className="py-2">Branch Hub</th>
                <th className="py-2">City</th>
                <th className="py-2">Fleet Units</th>
                <th className="py-2">Bookings</th>
                <th className="py-2 text-right">Realized Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {summary.branchPerf.map((b) => (
                <tr key={b.name}>
                  <td className="py-2.5 font-semibold">{b.name}</td>
                  <td className="py-2.5">{b.city}</td>
                  <td className="py-2.5 font-mono">{b.units}</td>
                  <td className="py-2.5 font-mono">{b.bookings}</td>
                  <td className="py-2.5 font-mono text-right">{formatINR(b.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {reportTab === 'refunds' && (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/10 text-[11px] uppercase text-slate-muted">
                <th className="py-2">Booking Ref</th>
                <th className="py-2">Customer</th>
                <th className="py-2">Category</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {summary.refunds.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 font-mono font-semibold">{r.bookingReference}</td>
                  <td className="py-2.5">{r.customerName}</td>
                  <td className="py-2.5 capitalize">{r.type.replace(/_/g, ' ')}</td>
                  <td className="py-2.5 font-semibold">{r.status}</td>
                  <td className="py-2.5 font-mono text-right">{formatINR(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {reportTab === 'coupons' && (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/10 text-[11px] uppercase text-slate-muted">
                <th className="py-2">Coupon Code</th>
                <th className="py-2">Status</th>
                <th className="py-2">Redemptions</th>
                <th className="py-2 text-right">Total Discount Granted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {summary.couponStats.map((c) => (
                <tr key={c.code}>
                  <td className="py-2.5 font-mono font-semibold">{c.code}</td>
                  <td className="py-2.5">{c.active}</td>
                  <td className="py-2.5 font-mono">{c.uses}</td>
                  <td className="py-2.5 font-mono text-right">{formatINR(c.discountTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {reportTab === 'offers' && (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/10 text-[11px] uppercase text-slate-muted">
                <th className="py-2">Offer Title</th>
                <th className="py-2">Coupon</th>
                <th className="py-2">Campaigns Dispatched</th>
                <th className="py-2 text-right">Messages Delivered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {summary.offerStats.map((o) => (
                <tr key={o.title}>
                  <td className="py-2.5 font-semibold">{o.title}</td>
                  <td className="py-2.5 font-mono">{o.coupon}</td>
                  <td className="py-2.5 font-mono">{o.campaigns}</td>
                  <td className="py-2.5 font-mono text-right">{o.delivered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!['utilization', 'branch_performance', 'refunds', 'coupons', 'offers'].includes(reportTab) && (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/10 text-[11px] uppercase text-slate-muted">
                <th className="py-2">Reference / Item</th>
                <th className="py-2">Customer / Actor</th>
                <th className="py-2">Detail</th>
                <th className="py-2 text-right">Amount / Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {reportTab === 'collections' &&
                summary.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 font-mono font-semibold">{p.bookingReference}</td>
                    <td className="py-2.5 font-mono">{p.gatewayRef}</td>
                    <td className="py-2.5">{p.method} · {new Date(p.createdAt).toLocaleDateString('en-IN')}</td>
                    <td className="py-2.5 font-mono text-right">{formatINR(p.amount)} ({p.status})</td>
                  </tr>
                ))}
              {reportTab === 'staff_activity' &&
                summary.logs.slice(0, 40).map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 font-mono font-semibold">{l.action}</td>
                    <td className="py-2.5 font-mono">{l.actorName || l.actorRole}</td>
                    <td className="py-2.5">{l.details}</td>
                    <td className="py-2.5 font-mono text-right">{new Date(l.timestamp).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              {reportTab === 'customers' &&
                summary.customers.map((c) => (
                  <tr key={c.uid}>
                    <td className="py-2.5 font-semibold">{c.displayName}</td>
                    <td className="py-2.5 font-mono">{c.phone || c.email}</td>
                    <td className="py-2.5">KYC: {c.kycStatus}</td>
                    <td className="py-2.5 text-right">{c.accountStatus}</td>
                  </tr>
                ))}
              {['revenue', 'bookings', 'balances', 'cancellations'].includes(reportTab) &&
                (reportTab === 'cancellations' ? summary.cancelledList : summary.bookings).map((b) => (
                  <tr key={b.id}>
                    <td className="py-2.5 font-mono font-semibold">{b.bookingReference}</td>
                    <td className="py-2.5">{b.customerName}</td>
                    <td className="py-2.5">{b.vehicleName} · {b.status}</td>
                    <td className="py-2.5 font-mono text-right">
                      {reportTab === 'balances'
                        ? formatINR(b.pricing?.balanceDueAtPickup || 0)
                        : formatINR(b.pricing?.totalPayable || 0)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
