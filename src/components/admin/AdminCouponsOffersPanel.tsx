import React, { useState } from 'react';
import { toast } from 'sonner';
import {
  BellRing,
  CheckCircle2,
  Edit3,
  Megaphone,
  Plus,
  Send,
  Ticket,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch, formatINR } from '../../lib/api';
import { resolveVehicleImage } from '../../lib/mediaAssets';
import { hasAdminPermission } from '../../lib/permissions';
import type {
  Coupon,
  NotificationCampaign,
  Offer,
  OfferType,
  RentalDurationTier,
  UserProfile,
  Vehicle,
  VehicleCategory,
} from '../../types';

interface AdminCouponsOffersPanelProps {
  profile: UserProfile;
  coupons: Coupon[];
  offers: Offer[];
  campaigns: NotificationCampaign[];
  customers: UserProfile[];
  vehicles: Vehicle[];
  onReload: () => Promise<void>;
}

const CATEGORIES: VehicleCategory[] = [
  'Hatchback',
  'Sedan',
  'SUV',
  'MUV',
  'Luxury',
  'Premium',
  'Electric',
];
const DURATIONS: RentalDurationTier[] = ['hourly', 'daily', 'weekly', 'monthly'];

export const AdminCouponsOffersPanel: React.FC<AdminCouponsOffersPanelProps> = ({
  profile,
  coupons,
  offers,
  campaigns,
  customers,
  vehicles,
  onReload,
}) => {
  const canManageCoupons = hasAdminPermission(profile, 'manage_coupons');
  const canPublishOffers = hasAdminPermission(profile, 'publish_offers');

  const [subTab, setSubTab] = useState<'coupons' | 'offers'>(
    canManageCoupons ? 'coupons' : 'offers'
  );
  const [busy, setBusy] = useState(false);

  // Coupon Form State
  const [editingCouponId, setEditingCouponId] = useState<string | null>(null);
  const [cCode, setCCode] = useState('');
  const [cType, setCType] = useState<'percent' | 'flat'>('percent');
  const [cValue, setCValue] = useState('10');
  const [cMinAmount, setCMinAmount] = useState('2000');
  const [cMaxDiscount, setCMaxDiscount] = useState('1500');
  const [cDesc, setCDesc] = useState('');
  const [cStartDate, setCStartDate] = useState('2026-01-01');
  const [cExpiryDate, setCExpiryDate] = useState('2028-12-31');
  const [cLimitTotal, setCLimitTotal] = useState('200');
  const [cLimitPerCustomer, setCLimitPerCustomer] = useState('2');
  const [cCategories, setCCategories] = useState<VehicleCategory[]>([]);
  const [cDurations, setCDurations] = useState<RentalDurationTier[]>([]);
  const [cNewCustomerOnly, setCNewCustomerOnly] = useState(false);
  const [cActive, setCActive] = useState(true);

  // Offer Form State
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [oTitle, setOTitle] = useState('');
  const [oSubtitle, setOSubtitle] = useState('');
  const [oDescription, setODescription] = useState('');
  const [oType, setOType] = useState<OfferType>('banner');
  const [oBadgeText, setOBadgeText] = useState('LIMITED OFFER');
  const [oDiscountLabel, setODiscountLabel] = useState('15% OFF');
  const [oBannerImage, setOBannerImage] = useState('hero');
  const [oCtaText, setOCtaText] = useState('Explore Fleet');
  const [oCtaLink, setOCtaLink] = useState('/vehicles');
  const [oCouponCode, setOCouponCode] = useState('');
  const [oFeaturedVehicleId, setOFeaturedVehicleId] = useState('');
  const [oStartDate, setOStartDate] = useState('2026-01-01');
  const [oEndDate, setOEndDate] = useState('2028-12-31');
  const [oActive, setOActive] = useState(true);

  // Notify Customers Modal State
  const [notifyOffer, setNotifyOffer] = useState<Offer | null>(null);
  const [nTitle, setNTitle] = useState('');
  const [nMessage, setNMessage] = useState('');
  const [nAudience, setNAudience] = useState<'all_eligible' | 'segment' | 'selected'>('all_eligible');
  const [nSegment, setNSegment] = useState<'all_customers' | 'repeat_customers' | 'new_customers' | 'kyc_verified'>('all_customers');
  const [nSelectedUsers, setNSelectedUsers] = useState<string[]>([]);
  const [nChannels, setNChannels] = useState<('in_app' | 'fcm' | 'whatsapp')[]>(['in_app', 'whatsapp']);
  const [nScheduledFor, setNScheduledFor] = useState('');

  const resetCouponForm = () => {
    setEditingCouponId(null);
    setCCode('');
    setCType('percent');
    setCValue('10');
    setCMinAmount('2000');
    setCMaxDiscount('1500');
    setCDesc('');
    setCStartDate('2026-01-01');
    setCExpiryDate('2028-12-31');
    setCLimitTotal('200');
    setCLimitPerCustomer('2');
    setCCategories([]);
    setCDurations([]);
    setCNewCustomerOnly(false);
    setCActive(true);
  };

  const populateCouponForm = (c: Coupon) => {
    setEditingCouponId(c.id);
    setCCode(c.code);
    setCType(c.discountType);
    setCValue(String(c.discountValue));
    setCMinAmount(String(c.minBookingAmount));
    setCMaxDiscount(String(c.maxDiscountAmount));
    setCDesc(c.description);
    setCStartDate((c.startDate || '').slice(0, 10));
    setCExpiryDate((c.expiryDate || '').slice(0, 10));
    setCLimitTotal(String(c.usageLimitTotal || 0));
    setCLimitPerCustomer(String(c.usageLimitPerCustomer || 0));
    setCCategories(c.eligibleCategories || []);
    setCDurations(c.eligibleDurations || []);
    setCNewCustomerOnly(Boolean(c.newCustomerOnly));
    setCActive(c.active);
  };

  const handleSaveCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        code: cCode.trim().toUpperCase(),
        discountType: cType,
        discountValue: Number(cValue),
        minBookingAmount: Number(cMinAmount || 0),
        maxDiscountAmount: Number(cMaxDiscount || 0),
        description: cDesc.trim(),
        startDate: cStartDate ? `${cStartDate}T00:00:00.000Z` : '',
        expiryDate: cExpiryDate ? `${cExpiryDate}T23:59:59.000Z` : '',
        usageLimitTotal: Number(cLimitTotal || 0),
        usageLimitPerCustomer: Number(cLimitPerCustomer || 0),
        eligibleCategories: cCategories,
        eligibleDurations: cDurations,
        newCustomerOnly: cNewCustomerOnly,
        active: cActive,
      };
      if (editingCouponId) {
        await apiFetch(`/api/admin/coupons/${editingCouponId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast.success(`Updated coupon ${payload.code}`);
      } else {
        await apiFetch('/api/admin/coupons', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success(`Created coupon ${payload.code}`);
      }
      resetCouponForm();
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Coupon save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleCoupon = async (c: Coupon) => {
    await apiFetch(`/api/admin/coupons/${c.id}`, {
      method: 'PUT',
      body: JSON.stringify({ active: !c.active }),
    });
    toast.success(`Coupon ${c.code} ${c.active ? 'deactivated' : 'activated'}`);
    await onReload();
  };

  const handleDeleteCoupon = async (id: string) => {
    await apiFetch(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    toast.success('Coupon deleted');
    await onReload();
  };

  const resetOfferForm = () => {
    setEditingOfferId(null);
    setOTitle('');
    setOSubtitle('');
    setODescription('');
    setOType('banner');
    setOBadgeText('LIMITED OFFER');
    setODiscountLabel('15% OFF');
    setOBannerImage('hero');
    setOCtaText('Explore Fleet');
    setOCtaLink('/vehicles');
    setOCouponCode('');
    setOFeaturedVehicleId('');
    setOStartDate('2026-01-01');
    setOEndDate('2028-12-31');
    setOActive(true);
  };

  const populateOfferForm = (o: Offer) => {
    setEditingOfferId(o.id);
    setOTitle(o.title);
    setOSubtitle(o.subtitle);
    setODescription(o.description);
    setOType(o.offerType);
    setOBadgeText(o.badgeText || '');
    setODiscountLabel(o.discountLabel || '');
    setOBannerImage(o.bannerImage || 'hero');
    setOCtaText(o.ctaText || 'Explore Fleet');
    setOCtaLink(o.ctaLink || '/vehicles');
    setOCouponCode(o.couponCode || '');
    setOFeaturedVehicleId(o.featuredVehicleId || '');
    setOStartDate(o.startDate || '2026-01-01');
    setOEndDate(o.endDate || '2028-12-31');
    setOActive(o.active);
  };

  const handleOfferBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_200_000) {
      toast.error('Offer banner must be smaller than 1.2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setOBannerImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        title: oTitle,
        subtitle: oSubtitle,
        description: oDescription,
        offerType: oType,
        badgeText: oBadgeText,
        discountLabel: oDiscountLabel,
        bannerImage: oBannerImage,
        ctaText: oCtaText,
        ctaLink: oCtaLink,
        couponCode: oCouponCode.trim().toUpperCase(),
        featuredVehicleId: oFeaturedVehicleId,
        startDate: oStartDate,
        endDate: oEndDate,
        active: oActive,
      };
      if (editingOfferId) {
        await apiFetch(`/api/admin/offers/${editingOfferId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast.success('Updated promotional offer');
      } else {
        await apiFetch('/api/admin/offers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('Published new website offer');
      }
      resetOfferForm();
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Offer save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteOffer = async (id: string) => {
    await apiFetch(`/api/admin/offers/${id}`, { method: 'DELETE' });
    toast.success('Offer deleted');
    await onReload();
  };

  const openNotifyModal = (o: Offer) => {
    setNotifyOffer(o);
    setNTitle(o.title);
    setNMessage(
      `${o.description}${o.couponCode ? ` Use code ${o.couponCode} at checkout.` : ''}`
    );
    setNAudience('all_eligible');
    setNChannels(['in_app', 'whatsapp']);
    setNScheduledFor('');
  };

  const handleDispatchNotificationCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifyOffer) return;
    if (nChannels.length === 0) {
      toast.error('Select at least one notification channel.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ campaign: NotificationCampaign }>(
        `/api/admin/offers/${notifyOffer.id}/notify`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: nTitle,
            message: nMessage,
            audienceType: nAudience,
            segmentKey: nAudience === 'segment' ? nSegment : undefined,
            selectedUserIds: nAudience === 'selected' ? nSelectedUsers : [],
            channels: nChannels,
            scheduledFor: nScheduledFor || undefined,
          }),
        }
      );
      toast.success(
        `Campaign ${res.campaign.status}: ${res.campaign.recipientCount} eligible customer(s), ${res.campaign.skippedOptOutCount} opted-out skipped.`
      );
      setNotifyOffer(null);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Campaign dispatch failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2">
        {canManageCoupons && (
          <button
            type="button"
            onClick={() => setSubTab('coupons')}
            className={`px-4 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'coupons'
                ? 'bg-obsidian text-white'
                : 'bg-white border border-black/15 text-ink hover:border-gold'
            }`}
          >
            <Ticket className="w-4 h-4 text-gold" />
            Coupons & Discounts ({coupons.length})
          </button>
        )}
        {canPublishOffers && (
          <button
            type="button"
            onClick={() => setSubTab('offers')}
            className={`px-4 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'offers'
                ? 'bg-obsidian text-white'
                : 'bg-white border border-black/15 text-ink hover:border-gold'
            }`}
          >
            <Megaphone className="w-4 h-4 text-gold" />
            Website Offers & Customer Campaigns ({offers.length})
          </button>
        )}
      </div>

      {/* COUPONS SUB-TAB */}
      {subTab === 'coupons' && canManageCoupons && (
        <div className="grid lg:grid-cols-12 gap-6">
          <form
            onSubmit={(e) => void handleSaveCoupon(e)}
            className="lg:col-span-5 bg-white border border-black/10 rounded-xl p-5 space-y-3 h-fit"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold">
                {editingCouponId ? 'Edit Coupon' : 'Create Promotional Coupon'}
              </h2>
              {editingCouponId && (
                <button
                  type="button"
                  onClick={resetCouponForm}
                  className="text-gold-hover font-semibold hover:underline cursor-pointer"
                >
                  New Coupon
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Coupon Code *</label>
                <input
                  type="text"
                  required
                  value={cCode}
                  onChange={(e) => setCCode(e.target.value.toUpperCase())}
                  placeholder="MONSOON20"
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Discount Type</label>
                <select
                  value={cType}
                  onChange={(e) => setCType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                >
                  <option value="percent">Percent (%)</option>
                  <option value="flat">Flat Amount (₹)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Discount Value</label>
                <input
                  type="number"
                  required
                  value={cValue}
                  onChange={(e) => setCValue(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Max Discount Cap (₹)</label>
                <input
                  type="number"
                  value={cMaxDiscount}
                  onChange={(e) => setCMaxDiscount(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Min Booking (₹)</label>
                <input
                  type="number"
                  value={cMinAmount}
                  onChange={(e) => setCMinAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Total Usage Limit (0=∞)</label>
                <input
                  type="number"
                  value={cLimitTotal}
                  onChange={(e) => setCLimitTotal(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Start Date</label>
                <input
                  type="date"
                  value={cStartDate}
                  onChange={(e) => setCStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={cExpiryDate}
                  onChange={(e) => setCExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-muted mb-1">Per-Customer Usage Limit (0=∞)</label>
              <input
                type="number"
                value={cLimitPerCustomer}
                onChange={(e) => setCLimitPerCustomer(e.target.value)}
                className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-muted mb-1">Description</label>
              <input
                type="text"
                required
                value={cDesc}
                onChange={(e) => setCDesc(e.target.value)}
                placeholder="20% off weekend SUV & Sedan rentals"
                className="w-full px-3 py-2 border border-black/15 rounded-lg"
              />
            </div>

            <div>
              <p className="font-semibold text-slate-muted mb-1">Eligible Vehicle Categories (Empty = All)</p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((cat) => (
                  <label key={cat} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-alabaster border border-black/10 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cCategories.includes(cat)}
                      onChange={(e) =>
                        setCCategories((prev) =>
                          e.target.checked ? [...prev, cat] : prev.filter((x) => x !== cat)
                        )
                      }
                    />
                    {cat}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="font-semibold text-slate-muted mb-1">Eligible Durations (Empty = All)</p>
              <div className="flex flex-wrap gap-1.5">
                {DURATIONS.map((dur) => (
                  <label key={dur} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-alabaster border border-black/10 cursor-pointer capitalize">
                    <input
                      type="checkbox"
                      checked={cDurations.includes(dur)}
                      onChange={(e) =>
                        setCDurations((prev) =>
                          e.target.checked ? [...prev, dur] : prev.filter((x) => x !== dur)
                        )
                      }
                    />
                    {dur}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-4 pt-1">
              <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={cNewCustomerOnly}
                  onChange={(e) => setCNewCustomerOnly(e.target.checked)}
                />
                New Customer Only
              </label>
              <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={cActive}
                  onChange={(e) => setCActive(e.target.checked)}
                />
                Active
              </label>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite cursor-pointer"
            >
              {busy ? 'Saving...' : editingCouponId ? 'Update Coupon' : 'Create Coupon'}
            </button>
          </form>

          <div className="lg:col-span-7 space-y-3">
            {coupons.map((c) => (
              <div key={c.id} className="bg-white border border-black/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-ink">{c.code}</span>
                    <span className="text-gold-hover font-semibold">
                      {c.discountType === 'percent' ? `${c.discountValue}% OFF` : `${formatINR(c.discountValue)} OFF`}
                    </span>
                    <span className={`text-[11px] font-semibold ${c.active ? 'text-emerald-700' : 'text-red-700'}`}>
                      {c.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-slate-muted">{c.description}</p>
                  <p className="font-mono text-[11px] text-slate-muted">
                    Min {formatINR(c.minBookingAmount)} · Cap {c.maxDiscountAmount ? formatINR(c.maxDiscountAmount) : 'None'} · Uses {c.usedCount || 0}/{c.usageLimitTotal || '∞'}
                    {c.newCustomerOnly ? ' · First Booking Only' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => populateCouponForm(c)}
                    className="px-2.5 py-1.5 border border-black/15 rounded-md font-semibold hover:border-gold cursor-pointer"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleCoupon(c)}
                    className="px-2.5 py-1.5 bg-alabaster border border-black/15 rounded-md font-semibold cursor-pointer"
                  >
                    {c.active ? 'Pause' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteCoupon(c.id)}
                    className="p-1.5 border border-red-200 text-red-700 rounded-md hover:bg-red-50 cursor-pointer"
                    aria-label="Delete coupon"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* OFFERS & CAMPAIGNS SUB-TAB */}
      {subTab === 'offers' && canPublishOffers && (
        <div className="space-y-6">
          <div className="grid lg:grid-cols-12 gap-6">
            <form
              onSubmit={(e) => void handleSaveOffer(e)}
              className="lg:col-span-6 bg-white border border-black/10 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold">
                  {editingOfferId ? 'Edit Website Offer' : 'Publish Website Offer'}
                </h2>
                {editingOfferId && (
                  <button type="button" onClick={resetOfferForm} className="text-gold-hover font-semibold hover:underline cursor-pointer">
                    New Offer
                  </button>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Offer Title *</label>
                  <input
                    type="text"
                    required
                    value={oTitle}
                    onChange={(e) => setOTitle(e.target.value)}
                    placeholder="Monsoon Executive Escape"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Offer Type</label>
                  <select
                    value={oType}
                    onChange={(e) => setOType(e.target.value as OfferType)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    <option value="banner">Homepage Banner</option>
                    <option value="festival">Festival Special</option>
                    <option value="seasonal">Seasonal Offer</option>
                    <option value="limited_time">Limited-Time Deal</option>
                    <option value="featured_vehicle">Featured Vehicle Offer</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Badge Text</label>
                  <input
                    type="text"
                    value={oBadgeText}
                    onChange={(e) => setOBadgeText(e.target.value)}
                    placeholder="FESTIVE PRIVILEGE"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Discount Label</label>
                  <input
                    type="text"
                    value={oDiscountLabel}
                    onChange={(e) => setODiscountLabel(e.target.value)}
                    placeholder="15% OFF"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-muted mb-1">Subtitle</label>
                <input
                  type="text"
                  value={oSubtitle}
                  onChange={(e) => setOSubtitle(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-muted mb-1">Description</label>
                <textarea
                  rows={2}
                  value={oDescription}
                  onChange={(e) => setODescription(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Linked Coupon Code</label>
                  <input
                    type="text"
                    value={oCouponCode}
                    onChange={(e) => setOCouponCode(e.target.value.toUpperCase())}
                    placeholder="ELITE10"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Featured Vehicle (Optional)</label>
                  <select
                    value={oFeaturedVehicleId}
                    onChange={(e) => setOFeaturedVehicleId(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    <option value="">None</option>
                    {vehicles.filter((v) => !v.archived).map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">CTA Button Text</label>
                  <input
                    type="text"
                    value={oCtaText}
                    onChange={(e) => setOCtaText(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">CTA Link</label>
                  <input
                    type="text"
                    value={oCtaLink}
                    onChange={(e) => setOCtaLink(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Start Date</label>
                  <input
                    type="date"
                    value={oStartDate}
                    onChange={(e) => setOStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">End Date</label>
                  <input
                    type="date"
                    value={oEndDate}
                    onChange={(e) => setOEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="px-3 py-2 bg-alabaster border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:border-gold">
                  <Upload className="w-3.5 h-3.5 text-gold-hover" />
                  Upload Offer Image
                  <input type="file" accept="image/*" onChange={handleOfferBannerUpload} className="hidden" />
                </label>
                <input
                  type="text"
                  value={oBannerImage.startsWith('data:') ? '' : oBannerImage}
                  onChange={(e) => setOBannerImage(e.target.value)}
                  placeholder="Or preset (hero, thar, nexon_ev) / URL"
                  className="flex-1 px-3 py-2 border border-black/15 rounded-lg"
                />
                <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                  <input type="checkbox" checked={oActive} onChange={(e) => setOActive(e.target.checked)} />
                  Active on Website
                </label>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite cursor-pointer"
              >
                {busy ? 'Saving...' : editingOfferId ? 'Update Website Offer' : 'Publish Offer'}
              </button>
            </form>

            {/* Live Storefront Offer Preview + Active Offers List */}
            <div className="lg:col-span-6 space-y-4">
              <div className="bg-obsidian text-white rounded-xl overflow-hidden border border-gold/30">
                <div className="px-4 py-2 bg-charcoal border-b border-white/10 text-[11px] font-mono text-gold">
                  Live Storefront Offer Card Preview
                </div>
                <div className="grid sm:grid-cols-12">
                  <div className="sm:col-span-5 h-44 sm:h-auto bg-charcoal">
                    <img
                      src={resolveVehicleImage(oBannerImage || 'hero')}
                      alt={oTitle || 'Offer Preview'}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="sm:col-span-7 p-5 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-gold">
                      <span>{oBadgeText || oType.toUpperCase()}</span>
                      <span>{oDiscountLabel}</span>
                    </div>
                    <h3 className="font-display text-lg font-semibold text-white">
                      {oTitle || 'Your Promotional Offer Title'}
                    </h3>
                    <p className="text-white/75 text-[11px]">
                      {oDescription || oSubtitle || 'Offer details visible on the homepage & fleet pages.'}
                    </p>
                    <div className="pt-2 flex flex-wrap items-center gap-2">
                      {oCouponCode && (
                        <span className="font-mono text-[11px] px-2 py-1 rounded bg-white/10 text-gold">
                          CODE: {oCouponCode}
                        </span>
                      )}
                      <span className="px-3 py-1.5 rounded bg-gold text-obsidian font-semibold text-[11px]">
                        {oCtaText || 'Explore Fleet'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {offers.map((o) => (
                  <div key={o.id} className="bg-white border border-black/10 rounded-xl p-4 space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm text-ink">{o.title}</p>
                        <p className="text-slate-muted">
                          {o.offerType} · {o.startDate} to {o.endDate} ·{' '}
                          <strong className={o.active ? 'text-emerald-700' : 'text-red-700'}>
                            {o.active ? 'Active' : 'Inactive'}
                          </strong>
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => openNotifyModal(o)}
                          className="px-3 py-1.5 bg-gold text-obsidian font-semibold rounded-md hover:bg-gold-bright inline-flex items-center gap-1 cursor-pointer"
                        >
                          <BellRing className="w-3.5 h-3.5" />
                          NOTIFY REGISTERED CUSTOMERS
                        </button>
                        <button
                          type="button"
                          onClick={() => populateOfferForm(o)}
                          className="px-2.5 py-1.5 border border-black/15 rounded-md font-semibold cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteOffer(o.id)}
                          className="p-1.5 border border-red-200 text-red-700 rounded-md cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Campaign History */}
          <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
            <h3 className="font-display text-xl font-semibold">
              Notification Campaign History ({campaigns.length})
            </h3>
            {campaigns.length === 0 ? (
              <p className="text-slate-muted">No offer campaigns dispatched yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-black/10 text-[11px] uppercase tracking-wider text-slate-muted">
                      <th className="py-2 pr-3">Campaign</th>
                      <th className="py-2 pr-3">Audience</th>
                      <th className="py-2 pr-3">Channels</th>
                      <th className="py-2 pr-3">Eligible</th>
                      <th className="py-2 pr-3">Delivered</th>
                      <th className="py-2 pr-3">Opted-Out Skipped</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10">
                    {campaigns.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2.5 pr-3">
                          <p className="font-semibold text-ink">{c.title}</p>
                          <p className="text-[11px] text-slate-muted">{new Date(c.createdAt).toLocaleString('en-IN')}</p>
                        </td>
                        <td className="py-2.5 pr-3 font-mono">{c.audienceType} {c.segmentKey ? `(${c.segmentKey})` : ''}</td>
                        <td className="py-2.5 pr-3 font-mono">{c.channels.join(', ')}</td>
                        <td className="py-2.5 pr-3 font-mono">{c.recipientCount}</td>
                        <td className="py-2.5 pr-3 font-mono text-emerald-700">{c.deliveredCount}</td>
                        <td className="py-2.5 pr-3 font-mono text-amber-700">{c.skippedOptOutCount}</td>
                        <td className="py-2.5 font-semibold text-gold-hover">{c.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* NOTIFY REGISTERED CUSTOMERS MODAL */}
      {notifyOffer && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleDispatchNotificationCampaign(e)}
            className="w-full max-w-xl bg-white rounded-2xl overflow-hidden"
          >
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div>
                <p className="text-[11px] text-gold font-mono uppercase">Customer Offer Campaign</p>
                <h3 className="font-display text-xl font-semibold">Notify Registered Customers</h3>
              </div>
              <button type="button" onClick={() => setNotifyOffer(null)} className="p-1.5 text-white/75 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[75vh] overflow-y-auto space-y-4">
              <div className="p-3 rounded-lg bg-alabaster border border-black/10 text-[11px] text-slate-muted">
                Promotional messages automatically honor each customer&apos;s <strong className="text-ink">Marketing Consent</strong> and{' '}
                <strong className="text-ink">WhatsApp Opt-Out</strong> preferences.
              </div>

              <div>
                <label className="block font-semibold text-slate-muted mb-1">Notification Title</label>
                <input
                  type="text"
                  required
                  value={nTitle}
                  onChange={(e) => setNTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-muted mb-1">Message Body</label>
                <textarea
                  rows={3}
                  required
                  value={nMessage}
                  onChange={(e) => setNMessage(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Target Audience</label>
                  <select
                    value={nAudience}
                    onChange={(e) => setNAudience(e.target.value as any)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    <option value="all_eligible">All Opted-In Customers</option>
                    <option value="segment">Customer Segment</option>
                    <option value="selected">Selected Individual Customers</option>
                  </select>
                </div>

                {nAudience === 'segment' && (
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Segment</label>
                    <select
                      value={nSegment}
                      onChange={(e) => setNSegment(e.target.value as any)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                    >
                      <option value="all_customers">All Customers</option>
                      <option value="repeat_customers">Repeat Customers (2+ bookings)</option>
                      <option value="new_customers">New Customers (0 bookings)</option>
                      <option value="kyc_verified">KYC Verified Customers</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Schedule Time (Optional)</label>
                  <input
                    type="datetime-local"
                    value={nScheduledFor}
                    onChange={(e) => setNScheduledFor(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                  />
                </div>
              </div>

              {nAudience === 'selected' && (
                <div className="max-h-36 overflow-y-auto p-3 rounded-lg bg-alabaster border border-black/10 space-y-1.5">
                  {customers.map((c) => (
                    <label key={c.uid} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={nSelectedUsers.includes(c.uid)}
                        onChange={(e) =>
                          setNSelectedUsers((prev) =>
                            e.target.checked ? [...prev, c.uid] : prev.filter((id) => id !== c.uid)
                          )
                        }
                      />
                      <span>{c.displayName} ({c.email || c.phone})</span>
                    </label>
                  ))}
                </div>
              )}

              <div>
                <p className="font-semibold text-slate-muted mb-1.5">Dispatch Channels</p>
                <div className="flex flex-wrap gap-3">
                  {(
                    [
                      { key: 'in_app', label: 'In-App Notification Center' },
                      { key: 'fcm', label: 'Web Push (FCM)' },
                      { key: 'whatsapp', label: 'WhatsApp Marketing Template' },
                    ] as const
                  ).map((ch) => (
                    <label key={ch.key} className="inline-flex items-center gap-1.5 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={nChannels.includes(ch.key)}
                        onChange={(e) =>
                          setNChannels((prev) =>
                            e.target.checked ? [...prev, ch.key] : prev.filter((x) => x !== ch.key)
                          )
                        }
                      />
                      {ch.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Live Notification Preview */}
              <div className="p-3.5 rounded-xl bg-obsidian text-white space-y-1">
                <p className="text-[10px] font-mono text-gold uppercase">Live Message Preview</p>
                <p className="font-semibold text-sm">{nTitle}</p>
                <p className="text-white/80 text-[11px]">{nMessage}</p>
              </div>
            </div>

            <div className="px-6 py-4 bg-alabaster border-t border-black/10 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNotifyOffer(null)}
                className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5 text-gold" />
                {busy ? 'Dispatching...' : nScheduledFor ? 'Schedule Campaign' : 'Send Notification Now'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
