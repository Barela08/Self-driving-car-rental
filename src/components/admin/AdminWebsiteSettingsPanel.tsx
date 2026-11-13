import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Globe,
  MapPin,
  MessageSquare,
  Plus,
  Star,
  Ticket,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { resolveVehicleImage } from '../../lib/mediaAssets';
import { hasAdminPermission } from '../../lib/permissions';
import { AdminCouponsOffersPanel } from './AdminCouponsOffersPanel';
import type {
  CompanySettings,
  Coupon,
  CustomerReview,
  CustomRole,
  NotificationCampaign,
  Offer,
  UserProfile,
  Vehicle,
} from '../../types';

interface AdminWebsiteSettingsPanelProps {
  profile?: UserProfile;
  roles?: CustomRole[];
  settings: CompanySettings | null;
  initialSubTab?: 'cms' | 'business' | 'coupons_offers' | 'reviews';
  coupons?: Coupon[];
  offers?: Offer[];
  campaigns?: NotificationCampaign[];
  customers?: UserProfile[];
  vehicles?: Vehicle[];
  onReload: () => Promise<void>;
}

export const AdminWebsiteSettingsPanel: React.FC<AdminWebsiteSettingsPanelProps> = ({
  profile,
  roles,
  settings,
  initialSubTab = 'cms',
  coupons = [],
  offers = [],
  campaigns = [],
  customers = [],
  vehicles = [],
  onReload,
}) => {
  const canManageWebsite =
    !profile ||
    profile.role === 'super_admin' ||
    hasAdminPermission(profile, 'manage_website_settings', roles);
  const canManagePromos =
    !profile ||
    profile.role === 'super_admin' ||
    hasAdminPermission(profile, 'manage_coupons', roles) ||
    hasAdminPermission(profile, 'publish_offers', roles);

  const [subTab, setSubTab] = useState<'cms' | 'business' | 'coupons_offers' | 'reviews'>(initialSubTab);
  const [busy, setBusy] = useState(false);
  const [reviews, setReviews] = useState<CustomerReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const loadReviews = useCallback(async () => {
    setReviewsLoading(true);
    try {
      const res = await apiFetch<{ reviews: CustomerReview[] }>('/api/admin/reviews');
      setReviews(res.reviews || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load customer reviews');
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subTab === 'reviews' && canManageWebsite) {
      void loadReviews();
    }
  }, [subTab, canManageWebsite, loadReviews]);

  const handleModerateReview = async (reviewId: string, status: 'Approved' | 'Rejected') => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/reviews/${reviewId}/moderate`, {
        method: 'POST',
        body: JSON.stringify({ status, moderatorNotes: reviewNotes[reviewId] || undefined }),
      });
      toast.success(`Review marked ${status}.`);
      await loadReviews();
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Moderation failed');
    } finally {
      setBusy(false);
    }
  };

  // Business Info
  const [companyName, setCompanyName] = useState('EliteDrive');
  const [websiteTitle, setWebsiteTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [registrationInfo, setRegistrationInfo] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');

  // Contact Info
  const [supportPhone, setSupportPhone] = useState('');
  const [secondaryPhone, setSecondaryPhone] = useState('');
  const [roadsideEmergencyPhone, setRoadsideEmergencyPhone] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [businessHours, setBusinessHours] = useState('');

  // Primary Hub & Delivery Zones
  const [operatingCityName, setOperatingCityName] = useState('Mumbai');
  const [operatingCityState, setOperatingCityState] = useState('Maharashtra');
  const [officeName, setOfficeName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [hubLat, setHubLat] = useState('19.0607');
  const [hubLng, setHubLng] = useState('72.8362');
  const [serviceRadiusKm, setServiceRadiusKm] = useState('35');
  const [baseDeliveryFee, setBaseDeliveryFee] = useState('299');
  const [perKmDeliveryFee, setPerKmDeliveryFee] = useState('25');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [officeImages, setOfficeImages] = useState<string[]>(['hero']);

  // Social Links
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [youtube, setYoutube] = useState('');
  const [twitter, setTwitter] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [otherSocial, setOtherSocial] = useState('');

  // Hero, Copy & Legal Policies
  const [heroBannerHeadline, setHeroBannerHeadline] = useState('');
  const [heroBannerSubcopy, setHeroBannerSubcopy] = useState('');
  const [heroBannerImage, setHeroBannerImage] = useState('hero');
  const [fleetSectionHeading, setFleetSectionHeading] = useState('');
  const [offersSectionHeading, setOffersSectionHeading] = useState('');
  const [footerTagline, setFooterTagline] = useState('');
  const [aboutSummary, setAboutSummary] = useState('');
  const [termsSummary, setTermsSummary] = useState('');
  const [privacySummary, setPrivacySummary] = useState('');
  const [cancellationSummary, setCancellationSummary] = useState('');
  const [refundSummary, setRefundSummary] = useState('');
  const [rentalRulesSummary, setRentalRulesSummary] = useState('');
  const [taxRatePercent, setTaxRatePercent] = useState('18');
  const [roadsideAddonPerDay, setRoadsideAddonPerDay] = useState('199');
  const [driverAddonPerDay, setDriverAddonPerDay] = useState('950');
  const [faqs, setFaqs] = useState<{ question: string; answer: string }[]>([]);

  useEffect(() => {
    if (!settings) return;
    setCompanyName(settings.companyName || 'EliteDrive');
    setWebsiteTitle(settings.websiteTitle || '');
    setTagline(settings.tagline || '');
    setRegistrationInfo(settings.registrationInfo || '');
    setLogoUrl(settings.logoUrl || '');
    setFaviconUrl(settings.faviconUrl || '');

    setSupportPhone(settings.supportPhone || '');
    setSecondaryPhone(settings.secondaryPhone || '');
    setRoadsideEmergencyPhone(settings.roadsideEmergencyPhone || '');
    setSupportEmail(settings.supportEmail || '');
    setWhatsappNumber(settings.whatsappNumber || '');
    setBusinessHours(settings.businessHours || '');

    setOperatingCityName(settings.operatingCityName || 'Mumbai');
    setOperatingCityState(settings.operatingCityState || 'Maharashtra');
    setOfficeName(settings.officeName || '');
    setBusinessAddress(settings.businessAddress || '');
    setHubLat(String(settings.hubLat ?? 19.0607));
    setHubLng(String(settings.hubLng ?? 72.8362));
    setServiceRadiusKm(String(settings.serviceRadiusKm ?? 35));
    setBaseDeliveryFee(String(settings.baseDeliveryFee ?? 299));
    setPerKmDeliveryFee(String(settings.perKmDeliveryFee ?? 25));
    setGoogleMapsUrl(settings.googleMapsUrl || '');
    setOfficeImages(settings.officeImages?.length ? settings.officeImages : ['hero']);

    setInstagram(settings.socialLinks?.instagram || '');
    setFacebook(settings.socialLinks?.facebook || '');
    setYoutube(settings.socialLinks?.youtube || '');
    setTwitter(settings.socialLinks?.twitter || '');
    setLinkedin(settings.socialLinks?.linkedin || '');
    setOtherSocial(settings.socialLinks?.other || '');

    setHeroBannerHeadline(settings.heroBannerHeadline || '');
    setHeroBannerSubcopy(settings.heroBannerSubcopy || '');
    setHeroBannerImage(settings.heroBannerImage || 'hero');
    setFleetSectionHeading(settings.fleetSectionHeading || '');
    setOffersSectionHeading(settings.offersSectionHeading || '');
    setFooterTagline(settings.footerTagline || '');
    setAboutSummary(settings.aboutSummary || '');
    setTermsSummary(settings.termsSummary || '');
    setPrivacySummary(settings.privacySummary || '');
    setCancellationSummary(settings.cancellationSummary || '');
    setRefundSummary(settings.refundSummary || '');
    setRentalRulesSummary(settings.rentalRulesSummary || '');
    setTaxRatePercent(String(settings.taxRatePercent ?? 18));
    setRoadsideAddonPerDay(String(settings.roadsideAddonPerDay ?? 199));
    setDriverAddonPerDay(String(settings.driverAddonPerDay ?? 950));
    setFaqs(settings.faqs || []);
  }, [settings]);

  const handleFileDataUrl = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 800_000) {
      toast.error('Image must be smaller than 800 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setter(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageWebsite) return;
    setBusy(true);
    try {
      const slug = operatingCityName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          companyName: companyName.trim(),
          websiteTitle: websiteTitle.trim(),
          tagline: tagline.trim(),
          registrationInfo: registrationInfo.trim(),
          logoUrl: logoUrl.trim(),
          faviconUrl: faviconUrl.trim(),
          supportPhone: supportPhone.trim(),
          secondaryPhone: secondaryPhone.trim(),
          roadsideEmergencyPhone: roadsideEmergencyPhone.trim(),
          supportEmail: supportEmail.trim(),
          whatsappNumber: whatsappNumber.trim(),
          businessHours: businessHours.trim(),
          operatingCityId: `city-${slug || 'primary'}`,
          operatingCityName: operatingCityName.trim(),
          operatingCityState: operatingCityState.trim(),
          officeName: officeName.trim(),
          businessAddress: businessAddress.trim(),
          hubLat: Number(hubLat),
          hubLng: Number(hubLng),
          serviceRadiusKm: Math.max(1, Number(serviceRadiusKm)),
          baseDeliveryFee: Math.max(0, Number(baseDeliveryFee)),
          perKmDeliveryFee: Math.max(0, Number(perKmDeliveryFee)),
          googleMapsUrl: googleMapsUrl.trim(),
          officeImages,
          socialLinks: {
            instagram: instagram.trim(),
            facebook: facebook.trim(),
            youtube: youtube.trim(),
            twitter: twitter.trim(),
            linkedin: linkedin.trim(),
            other: otherSocial.trim(),
          },
          heroBannerHeadline: heroBannerHeadline.trim(),
          heroBannerSubcopy: heroBannerSubcopy.trim(),
          heroBannerImage: heroBannerImage.trim(),
          fleetSectionHeading: fleetSectionHeading.trim(),
          offersSectionHeading: offersSectionHeading.trim(),
          footerTagline: footerTagline.trim(),
          aboutSummary: aboutSummary.trim(),
          termsSummary: termsSummary.trim(),
          privacySummary: privacySummary.trim(),
          cancellationSummary: cancellationSummary.trim(),
          refundSummary: refundSummary.trim(),
          rentalRulesSummary: rentalRulesSummary.trim(),
          taxRatePercent: Number(taxRatePercent || 18),
          roadsideAddonPerDay: Number(roadsideAddonPerDay || 199),
          driverAddonPerDay: Number(driverAddonPerDay || 950),
          faqs: faqs.filter((f) => f.question.trim() && f.answer.trim()),
        }),
      });
      toast.success('System & Website settings published live.');
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update website settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Sub-Tabs */}
      <div className="bg-white border border-black/10 rounded-xl p-3 flex flex-wrap gap-2">
        {canManageWebsite && (
          <>
            <button
              type="button"
              onClick={() => setSubTab('cms')}
              className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                subTab === 'cms' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink border border-black/10'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Website & CMS
            </button>
            <button
              type="button"
              onClick={() => setSubTab('business')}
              className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                subTab === 'business' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink border border-black/10'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              Business, Tax & Booking Rules
            </button>
          </>
        )}
        {canManagePromos && (
          <button
            type="button"
            onClick={() => setSubTab('coupons_offers')}
            className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'coupons_offers' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink border border-black/10'
            }`}
          >
            <Ticket className="w-3.5 h-3.5" />
            Coupons, Offers & Campaigns
          </button>
        )}
        {canManageWebsite && (
          <button
            type="button"
            onClick={() => setSubTab('reviews')}
            className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'reviews' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink border border-black/10'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Verified Reviews
          </button>
        )}
      </div>

      {subTab === 'reviews' && canManageWebsite && (
        <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-hover">
                Completed Trip Feedback Moderation
              </p>
              <h2 className="font-display text-xl font-semibold">
                Verified Customer Reviews ({reviews.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void loadReviews()}
              className="px-3 py-1.5 border border-black/15 rounded-lg font-semibold hover:border-gold cursor-pointer"
            >
              Refresh Reviews
            </button>
          </div>
          {reviewsLoading ? (
            <div className="h-32 rounded-xl bg-alabaster animate-pulse" />
          ) : reviews.length === 0 ? (
            <p className="text-slate-muted py-4">No verified customer trip reviews submitted yet.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {reviews.map((rev) => (
                <div key={rev.id} className="p-4 rounded-xl bg-alabaster border border-black/10 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-ink">{rev.customerName}</p>
                      <p className="font-mono text-[11px] text-slate-muted">
                        {rev.bookingReference} | {rev.vehicleName}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center gap-1 font-mono font-bold text-gold-hover">
                        <Star className="w-3.5 h-3.5 fill-gold text-gold" />
                        {rev.rating}/5
                      </span>
                      <p className="text-[11px] font-semibold text-ink mt-0.5">{rev.status}</p>
                    </div>
                  </div>
                  <p className="text-ink bg-white p-2.5 rounded-lg border border-black/10 leading-relaxed">
                    {rev.comment}
                  </p>
                  <input
                    type="text"
                    placeholder="Optional moderator note..."
                    value={reviewNotes[rev.id] || ''}
                    onChange={(e) => setReviewNotes((prev) => ({ ...prev, [rev.id]: e.target.value }))}
                    className="w-full px-3 py-1.5 bg-white border border-black/15 rounded-lg"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleModerateReview(rev.id, 'Approved')}
                      className="flex-1 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-gold" />
                      Approve & Publish
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleModerateReview(rev.id, 'Rejected')}
                      className="px-4 py-2 border border-red-300 text-red-700 font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'coupons_offers' && canManagePromos && profile && (
        <AdminCouponsOffersPanel
          profile={profile}
          coupons={coupons}
          offers={offers}
          campaigns={campaigns}
          customers={customers}
          vehicles={vehicles}
          onReload={onReload}
        />
      )}

      {(subTab === 'cms' || subTab === 'business') && canManageWebsite && (
        <form onSubmit={(e) => void handleSaveSettings(e)} className="space-y-6">
          {subTab === 'cms' && (
            <>
              {/* 1. Business Brand & Logo/Favicon */}
              <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-xl font-semibold">1. Business Brand, Logo & Website Title</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Company / Brand Name *</label>
                    <input type="text" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Browser Tab &lt;title&gt;</label>
                    <input type="text" value={websiteTitle} onChange={(e) => setWebsiteTitle(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Brand Tagline</label>
                    <input type="text" value={tagline} onChange={(e) => setTagline(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block font-semibold text-slate-muted mb-1">Legal Registration / GSTIN Info (Shown on Invoices & Footer)</label>
                    <input type="text" value={registrationInfo} onChange={(e) => setRegistrationInfo(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4 pt-2">
                  <div className="p-3.5 rounded-xl bg-alabaster border border-black/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink">Header & Invoice Logo</span>
                      <label className="px-2.5 py-1 bg-white border border-black/15 rounded cursor-pointer font-semibold inline-flex items-center gap-1">
                        <Upload className="w-3 h-3 text-gold-hover" /> Upload
                        <input type="file" accept="image/*" onChange={(e) => handleFileDataUrl(e, setLogoUrl)} className="hidden" />
                      </label>
                    </div>
                    <input type="text" value={logoUrl.startsWith('data:') ? '' : logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="Or paste https://... logo URL" className="w-full px-3 py-1.5 bg-white border border-black/15 rounded-lg" />
                    {logoUrl && <img src={logoUrl} alt="Logo Preview" className="h-10 object-contain bg-obsidian p-1.5 rounded" />}
                  </div>

                  <div className="p-3.5 rounded-xl bg-alabaster border border-black/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink">Browser Favicon</span>
                      <label className="px-2.5 py-1 bg-white border border-black/15 rounded cursor-pointer font-semibold inline-flex items-center gap-1">
                        <Upload className="w-3 h-3 text-gold-hover" /> Upload
                        <input type="file" accept="image/*" onChange={(e) => handleFileDataUrl(e, setFaviconUrl)} className="hidden" />
                      </label>
                    </div>
                    <input type="text" value={faviconUrl.startsWith('data:') ? '' : faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} placeholder="Or paste https://... favicon URL" className="w-full px-3 py-1.5 bg-white border border-black/15 rounded-lg" />
                    {faviconUrl && <img src={faviconUrl} alt="Favicon Preview" className="w-8 h-8 object-contain bg-white p-1 rounded border border-black/10" />}
                  </div>
                </div>
              </div>

              {/* 2. Office Showcase & Social Links */}
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-white border border-black/10 rounded-xl p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-xl font-semibold">2. Office / Showroom Images</h2>
                    <label className="px-3 py-1.5 bg-alabaster border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1 cursor-pointer hover:border-gold">
                      <Upload className="w-3.5 h-3.5 text-gold-hover" /> Upload Photo
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          handleFileDataUrl(e, (url) => setOfficeImages((prev) => [...prev, url]))
                        }
                        className="hidden"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {officeImages.map((img, i) => (
                      <div key={i} className="relative rounded-lg overflow-hidden border border-black/10">
                        <img src={resolveVehicleImage(img)} alt={`Office ${i + 1}`} className="w-full h-20 object-cover" />
                        {officeImages.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setOfficeImages((prev) => prev.filter((_, idx) => idx !== i))}
                            className="absolute top-1 right-1 p-1 bg-obsidian/80 text-white rounded cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-black/10 rounded-xl p-6 space-y-3">
                  <h2 className="font-display text-xl font-semibold">3. Social Media Links</h2>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input type="text" placeholder="Instagram URL" value={instagram} onChange={(e) => setInstagram(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg" />
                    <input type="text" placeholder="Facebook URL" value={facebook} onChange={(e) => setFacebook(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg" />
                    <input type="text" placeholder="YouTube URL" value={youtube} onChange={(e) => setYoutube(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg" />
                    <input type="text" placeholder="X / Twitter URL" value={twitter} onChange={(e) => setTwitter(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg" />
                    <input type="text" placeholder="LinkedIn URL" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg" />
                    <input type="text" placeholder="Other Link URL" value={otherSocial} onChange={(e) => setOtherSocial(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                </div>
              </div>

              {/* 4. Storefront Copy, Policies & FAQs */}
              <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-xl font-semibold">4. Storefront Hero Copy, Legal Policies & FAQs</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Hero Banner Headline</label>
                    <input type="text" value={heroBannerHeadline} onChange={(e) => setHeroBannerHeadline(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Fleet Section Heading</label>
                    <input type="text" value={fleetSectionHeading} onChange={(e) => setFleetSectionHeading(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-muted mb-1">Hero Subcopy</label>
                    <textarea rows={2} value={heroBannerSubcopy} onChange={(e) => setHeroBannerSubcopy(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Offers Section Heading</label>
                    <input type="text" value={offersSectionHeading} onChange={(e) => setOffersSectionHeading(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Footer Tagline</label>
                    <input type="text" value={footerTagline} onChange={(e) => setFooterTagline(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-muted mb-1">Hero Background Image (URL/Preset or Upload)</label>
                    <div className="flex gap-2">
                      <input type="text" value={heroBannerImage.startsWith('data:') ? '' : heroBannerImage} onChange={(e) => setHeroBannerImage(e.target.value)} className="flex-1 px-3 py-2 border border-black/15 rounded-lg" />
                      <label className="px-3 py-2 bg-alabaster border border-black/15 rounded-lg cursor-pointer font-semibold">
                        Upload
                        <input type="file" accept="image/*" onChange={(e) => handleFileDataUrl(e, setHeroBannerImage)} className="hidden" />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">About Us Summary</label>
                    <textarea rows={2} value={aboutSummary} onChange={(e) => setAboutSummary(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Terms & Conditions</label>
                    <textarea rows={2} value={termsSummary} onChange={(e) => setTermsSummary(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Privacy Policy</label>
                    <textarea rows={2} value={privacySummary} onChange={(e) => setPrivacySummary(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Cancellation Policy</label>
                    <textarea rows={2} value={cancellationSummary} onChange={(e) => setCancellationSummary(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Refund Policy</label>
                    <textarea rows={2} value={refundSummary} onChange={(e) => setRefundSummary(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Self-Drive Rental Rules</label>
                    <textarea rows={2} value={rentalRulesSummary} onChange={(e) => setRentalRulesSummary(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                  </div>
                </div>

                <div className="pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-ink">Customer FAQs ({faqs.length})</p>
                    <button
                      type="button"
                      onClick={() => setFaqs((prev) => [...prev, { question: '', answer: '' }])}
                      className="text-gold-hover font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add FAQ
                    </button>
                  </div>
                  {faqs.map((faq, idx) => (
                    <div key={idx} className="grid sm:grid-cols-12 gap-2 p-2.5 rounded-lg bg-alabaster border border-black/10">
                      <input
                        type="text"
                        placeholder="Question"
                        value={faq.question}
                        onChange={(e) =>
                          setFaqs((prev) => prev.map((f, i) => (i === idx ? { ...f, question: e.target.value } : f)))
                        }
                        className="sm:col-span-5 px-2.5 py-1.5 bg-white border border-black/15 rounded"
                      />
                      <input
                        type="text"
                        placeholder="Answer"
                        value={faq.answer}
                        onChange={(e) =>
                          setFaqs((prev) => prev.map((f, i) => (i === idx ? { ...f, answer: e.target.value } : f)))
                        }
                        className="sm:col-span-6 px-2.5 py-1.5 bg-white border border-black/15 rounded"
                      />
                      <button
                        type="button"
                        onClick={() => setFaqs((prev) => prev.filter((_, i) => i !== idx))}
                        className="sm:col-span-1 flex items-center justify-center text-red-700 cursor-pointer"
                        aria-label="Remove FAQ"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {subTab === 'business' && (
            <>
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-white border border-black/10 rounded-xl p-6 space-y-3">
                  <h2 className="font-display text-xl font-semibold">Contact & Support Channels</h2>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Primary Support Phone</label>
                      <input type="text" value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Secondary / Desk Phone</label>
                      <input type="text" value={secondaryPhone} onChange={(e) => setSecondaryPhone(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">24x7 Emergency Roadside</label>
                      <input type="text" value={roadsideEmergencyPhone} onChange={(e) => setRoadsideEmergencyPhone(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">WhatsApp Support Number</label>
                      <input type="text" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Support Email</label>
                      <input type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Operating Hours</label>
                      <input type="text" value={businessHours} onChange={(e) => setBusinessHours(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-black/10 rounded-xl p-6 space-y-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">Primary Operating Hub & Geo-Radius</h2>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Operating City *</label>
                      <input type="text" required value={operatingCityName} onChange={(e) => setOperatingCityName(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">State</label>
                      <input type="text" value={operatingCityState} onChange={(e) => setOperatingCityState(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-muted mb-1">Central Office / Hub Name</label>
                      <input type="text" value={officeName} onChange={(e) => setOfficeName(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-muted mb-1">Hub Street Address</label>
                      <input type="text" value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Hub Latitude</label>
                      <input type="number" step="0.0001" value={hubLat} onChange={(e) => setHubLat(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Hub Longitude</label>
                      <input type="number" step="0.0001" value={hubLng} onChange={(e) => setHubLng(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Service Radius (km)</label>
                      <input type="number" min={1} value={serviceRadiusKm} onChange={(e) => setServiceRadiusKm(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Base Delivery (₹)</label>
                        <input type="number" min={0} value={baseDeliveryFee} onChange={(e) => setBaseDeliveryFee(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Per KM (₹)</label>
                        <input type="number" min={0} value={perKmDeliveryFee} onChange={(e) => setPerKmDeliveryFee(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-muted mb-1">Google Maps Direction Link</label>
                      <input type="text" value={googleMapsUrl} onChange={(e) => setGoogleMapsUrl(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-xl font-semibold">Tax & Add-on Pricing Defaults</h2>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">GST Rate (%)</label>
                    <input type="number" value={taxRatePercent} onChange={(e) => setTaxRatePercent(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Roadside Assistance / Day (₹)</label>
                    <input type="number" value={roadsideAddonPerDay} onChange={(e) => setRoadsideAddonPerDay(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Chauffeur Add-on / Day (₹)</label>
                    <input type="number" value={driverAddonPerDay} onChange={(e) => setDriverAddonPerDay(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="px-6 py-3 bg-obsidian text-white font-semibold rounded-xl hover:bg-graphite inline-flex items-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 text-gold" />
              {busy ? 'Publishing Settings...' : 'Save & Publish System Settings'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
