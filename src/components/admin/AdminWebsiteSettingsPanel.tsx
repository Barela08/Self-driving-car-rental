import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  Languages,
  MapPin,
  MessageSquare,
  Palette,
  Plus,
  Share2,
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
  LocalizedSiteCopy,
  NotificationCampaign,
  Offer,
  SocialPlatformKey,
  SocialProfileItem,
  SupportedLanguage,
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

const SOCIAL_PLATFORMS: { key: SocialPlatformKey; label: string; placeholder: string }[] = [
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/elitedrive.in' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/elitedrive' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@elitedrive' },
  { key: 'whatsapp', label: 'WhatsApp Channel / Link', placeholder: 'https://wa.me/919820011223' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/elitedrive' },
  { key: 'twitter', label: 'X / Twitter', placeholder: 'https://x.com/elitedrive' },
  { key: 'telegram', label: 'Telegram', placeholder: 'https://t.me/elitedrive' },
  { key: 'pinterest', label: 'Pinterest', placeholder: 'https://pinterest.com/elitedrive' },
  { key: 'threads', label: 'Threads', placeholder: 'https://threads.net/@elitedrive' },
  { key: 'snapchat', label: 'Snapchat', placeholder: 'https://snapchat.com/add/elitedrive' },
  { key: 'website', label: 'Official Website / Blog', placeholder: 'https://elitedrive.in/journal' },
  { key: 'custom', label: 'Custom Platform', placeholder: 'https://example.com/profile' },
];

const CMS_LANGUAGES: { code: SupportedLanguage; label: string }[] = [
  { code: 'en', label: 'English (EN)' },
  { code: 'hi', label: 'हिंदी (HI)' },
  { code: 'mr', label: 'मराठी (MR)' },
];

const EMPTY_LOCALIZED: LocalizedSiteCopy = {
  tagline: '',
  heroBannerHeadline: '',
  heroBannerSubcopy: '',
  fleetSectionHeading: '',
  offersSectionHeading: '',
  footerTagline: '',
  aboutSummary: '',
  howItWorksSummary: '',
  termsSummary: '',
  privacySummary: '',
  cancellationSummary: '',
  refundSummary: '',
  rentalRulesSummary: '',
  paymentInfoSummary: '',
};

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
  const [cmsLang, setCmsLang] = useState<SupportedLanguage>('en');
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

  // Business Brand & Identity
  const [companyName, setCompanyName] = useState('EliteDrive');
  const [brandName, setBrandName] = useState('EliteDrive Car Rentals');
  const [websiteTitle, setWebsiteTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [fullDescription, setFullDescription] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#C8A24D');
  const [secondaryColor, setSecondaryColor] = useState('#0F1420');
  const [defaultLanguage, setDefaultLanguage] = useState<SupportedLanguage>('en');
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

  // Dynamic 12-Platform Social Profiles Builder
  const [socialProfiles, setSocialProfiles] = useState<SocialProfileItem[]>([]);
  const [newSocialPlatform, setNewSocialPlatform] = useState<SocialPlatformKey>('instagram');
  const [newSocialLabel, setNewSocialLabel] = useState('Instagram');
  const [newSocialUrl, setNewSocialUrl] = useState('');

  // Primary English Copy, Policies, Steps & FAQs
  const [heroBannerHeadline, setHeroBannerHeadline] = useState('');
  const [heroBannerSubcopy, setHeroBannerSubcopy] = useState('');
  const [heroBannerImage, setHeroBannerImage] = useState('hero');
  const [fleetSectionHeading, setFleetSectionHeading] = useState('');
  const [offersSectionHeading, setOffersSectionHeading] = useState('');
  const [footerTagline, setFooterTagline] = useState('');
  const [aboutSummary, setAboutSummary] = useState('');
  const [howItWorksSummary, setHowItWorksSummary] = useState('');
  const [howItWorksSteps, setHowItWorksSteps] = useState<{ title: string; description: string }[]>([]);
  const [termsSummary, setTermsSummary] = useState('');
  const [privacySummary, setPrivacySummary] = useState('');
  const [cancellationSummary, setCancellationSummary] = useState('');
  const [refundSummary, setRefundSummary] = useState('');
  const [rentalRulesSummary, setRentalRulesSummary] = useState('');
  const [paymentInfoSummary, setPaymentInfoSummary] = useState('');
  const [taxRatePercent, setTaxRatePercent] = useState('18');
  const [roadsideAddonPerDay, setRoadsideAddonPerDay] = useState('199');
  const [driverAddonPerDay, setDriverAddonPerDay] = useState('950');
  const [faqs, setFaqs] = useState<{ question: string; answer: string }[]>([]);

  // Multilingual Overrides (HI & MR)
  const [localizedContent, setLocalizedContent] = useState<Partial<Record<SupportedLanguage, LocalizedSiteCopy>>>({
    hi: { ...EMPTY_LOCALIZED },
    mr: { ...EMPTY_LOCALIZED },
  });

  useEffect(() => {
    if (!settings) return;
    setCompanyName(settings.companyName || 'EliteDrive');
    setBrandName(settings.brandName || settings.companyName || 'EliteDrive Car Rentals');
    setWebsiteTitle(settings.websiteTitle || '');
    setTagline(settings.tagline || '');
    setShortDescription(settings.shortDescription || '');
    setFullDescription(settings.fullDescription || '');
    setPrimaryColor(settings.primaryColor || '#C8A24D');
    setSecondaryColor(settings.secondaryColor || '#0F1420');
    setDefaultLanguage(settings.defaultLanguage || 'en');
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

    if (Array.isArray(settings.socialProfiles)) {
      setSocialProfiles([...settings.socialProfiles].sort((a, b) => a.order - b.order));
    } else if (settings.socialLinks) {
      const migrated: SocialProfileItem[] = [];
      const entries: Array<[SocialPlatformKey, string, string | undefined]> = [
        ['instagram', 'Instagram', settings.socialLinks.instagram],
        ['facebook', 'Facebook', settings.socialLinks.facebook],
        ['youtube', 'YouTube', settings.socialLinks.youtube],
        ['twitter', 'X / Twitter', settings.socialLinks.twitter],
        ['linkedin', 'LinkedIn', settings.socialLinks.linkedin],
        ['custom', 'Website', settings.socialLinks.other],
      ];
      entries.forEach(([platform, label, url], idx) => {
        if (url && url.trim()) {
          migrated.push({
            id: `soc-${platform}-${idx + 1}`,
            platform,
            displayName: label,
            url: url.trim(),
            enabled: true,
            order: idx + 1,
          });
        }
      });
      setSocialProfiles(migrated);
    } else {
      setSocialProfiles([]);
    }

    setHeroBannerHeadline(settings.heroBannerHeadline || '');
    setHeroBannerSubcopy(settings.heroBannerSubcopy || '');
    setHeroBannerImage(settings.heroBannerImage || 'hero');
    setFleetSectionHeading(settings.fleetSectionHeading || '');
    setOffersSectionHeading(settings.offersSectionHeading || '');
    setFooterTagline(settings.footerTagline || '');
    setAboutSummary(settings.aboutSummary || '');
    setHowItWorksSummary(settings.howItWorksSummary || '');
    setHowItWorksSteps(
      settings.howItWorksSteps?.length
        ? settings.howItWorksSteps
        : [
            { title: 'Select Car & Schedule', description: 'Compare real-time unit availability, transparent daily tariffs, and refundable deposits.' },
            { title: 'Verify Pickup or Delivery', description: 'Collect from our flagship lounge or schedule doorstep handover within our service radius.' },
            { title: 'Complete Digital KYC & UPI', description: 'Upload Driving Licence & Govt ID once and settle via verified UPI with instant UTR tracking.' },
            { title: 'Drive & Return Seamless', description: 'Complete guided digital handover checklist with 24x7 concierge support throughout your trip.' },
          ]
    );
    setTermsSummary(settings.termsSummary || '');
    setPrivacySummary(settings.privacySummary || '');
    setCancellationSummary(settings.cancellationSummary || '');
    setRefundSummary(settings.refundSummary || '');
    setRentalRulesSummary(settings.rentalRulesSummary || '');
    setPaymentInfoSummary(settings.paymentInfoSummary || '');
    setTaxRatePercent(String(settings.taxRatePercent ?? 18));
    setRoadsideAddonPerDay(String(settings.roadsideAddonPerDay ?? 199));
    setDriverAddonPerDay(String(settings.driverAddonPerDay ?? 950));
    setFaqs(settings.faqs || []);

    setLocalizedContent({
      hi: { ...EMPTY_LOCALIZED, ...(settings.localizedContent?.hi || {}) },
      mr: { ...EMPTY_LOCALIZED, ...(settings.localizedContent?.mr || {}) },
    });
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

  const handleAddSocialProfile = () => {
    const cleanUrl = newSocialUrl.trim();
    if (!cleanUrl.startsWith('https://') && !cleanUrl.startsWith('http://')) {
      toast.error('Social URL must begin with https:// or http://');
      return;
    }
    const label = newSocialLabel.trim() || SOCIAL_PLATFORMS.find((p) => p.key === newSocialPlatform)?.label || 'Social';
    setSocialProfiles((prev) => [
      ...prev,
      {
        id: `soc-${newSocialPlatform}-${Date.now()}`,
        platform: newSocialPlatform,
        displayName: label,
        url: cleanUrl,
        enabled: true,
        order: prev.length + 1,
      },
    ]);
    setNewSocialUrl('');
    toast.success(`${label} added. Click Save & Publish Settings to apply live.`);
  };

  const moveSocialProfile = (index: number, delta: -1 | 1) => {
    setSocialProfiles((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy.map((p, idx) => ({ ...p, order: idx + 1 }));
    });
  };

  const updateLocalizedField = (lang: 'hi' | 'mr', key: keyof LocalizedSiteCopy, value: string) => {
    setLocalizedContent((prev) => ({
      ...prev,
      [lang]: {
        ...(prev[lang] || EMPTY_LOCALIZED),
        [key]: value,
      },
    }));
  };

  const activeCopyFieldValue = (key: keyof LocalizedSiteCopy): string => {
    if (cmsLang === 'en') {
      const enMap: Record<keyof LocalizedSiteCopy, string> = {
        tagline,
        heroBannerHeadline,
        heroBannerSubcopy,
        fleetSectionHeading,
        offersSectionHeading,
        footerTagline,
        aboutSummary,
        howItWorksSummary,
        termsSummary,
        privacySummary,
        cancellationSummary,
        refundSummary,
        rentalRulesSummary,
        paymentInfoSummary,
        faqs: '',
      };
      return enMap[key] || '';
    }
    return String(localizedContent[cmsLang]?.[key] || '');
  };

  const setActiveCopyFieldValue = (key: keyof LocalizedSiteCopy, val: string) => {
    if (cmsLang === 'en') {
      if (key === 'tagline') setTagline(val);
      else if (key === 'heroBannerHeadline') setHeroBannerHeadline(val);
      else if (key === 'heroBannerSubcopy') setHeroBannerSubcopy(val);
      else if (key === 'fleetSectionHeading') setFleetSectionHeading(val);
      else if (key === 'offersSectionHeading') setOffersSectionHeading(val);
      else if (key === 'footerTagline') setFooterTagline(val);
      else if (key === 'aboutSummary') setAboutSummary(val);
      else if (key === 'howItWorksSummary') setHowItWorksSummary(val);
      else if (key === 'termsSummary') setTermsSummary(val);
      else if (key === 'privacySummary') setPrivacySummary(val);
      else if (key === 'cancellationSummary') setCancellationSummary(val);
      else if (key === 'refundSummary') setRefundSummary(val);
      else if (key === 'rentalRulesSummary') setRentalRulesSummary(val);
      else if (key === 'paymentInfoSummary') setPaymentInfoSummary(val);
      return;
    }
    updateLocalizedField(cmsLang, key, val);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageWebsite) return;

    if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor.trim()) || !/^#[0-9A-Fa-f]{6}$/.test(secondaryColor.trim())) {
      toast.error('Primary and Secondary brand colors must be valid 6-digit hex codes (e.g. #C8A24D).');
      return;
    }

    for (const soc of socialProfiles) {
      if (!soc.url.trim().startsWith('https://') && !soc.url.trim().startsWith('http://')) {
        toast.error(`Social URL for ${soc.displayName} must start with https:// or http://`);
        return;
      }
    }

    setBusy(true);
    try {
      const slug = operatingCityName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          companyName: companyName.trim(),
          brandName: brandName.trim() || companyName.trim(),
          websiteTitle: websiteTitle.trim(),
          tagline: tagline.trim(),
          shortDescription: shortDescription.trim(),
          fullDescription: fullDescription.trim(),
          primaryColor: primaryColor.trim(),
          secondaryColor: secondaryColor.trim(),
          defaultLanguage,
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
          socialProfiles: socialProfiles.map((p, idx) => ({
            ...p,
            displayName: p.displayName.trim() || p.platform,
            url: p.url.trim(),
            order: idx + 1,
          })),
          heroBannerHeadline: heroBannerHeadline.trim(),
          heroBannerSubcopy: heroBannerSubcopy.trim(),
          heroBannerImage: heroBannerImage.trim(),
          fleetSectionHeading: fleetSectionHeading.trim(),
          offersSectionHeading: offersSectionHeading.trim(),
          footerTagline: footerTagline.trim(),
          aboutSummary: aboutSummary.trim(),
          howItWorksSummary: howItWorksSummary.trim(),
          howItWorksSteps: howItWorksSteps.filter((s) => s.title.trim() && s.description.trim()),
          termsSummary: termsSummary.trim(),
          privacySummary: privacySummary.trim(),
          cancellationSummary: cancellationSummary.trim(),
          refundSummary: refundSummary.trim(),
          rentalRulesSummary: rentalRulesSummary.trim(),
          paymentInfoSummary: paymentInfoSummary.trim(),
          taxRatePercent: Number(taxRatePercent || 18),
          roadsideAddonPerDay: Number(roadsideAddonPerDay || 199),
          driverAddonPerDay: Number(driverAddonPerDay || 950),
          faqs: faqs.filter((f) => f.question.trim() && f.answer.trim()),
          localizedContent: {
            hi: localizedContent.hi,
            mr: localizedContent.mr,
          },
        }),
      });
      toast.success('Brand theme, social links, and multilingual CMS published live.');
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
              className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                subTab === 'cms' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink border border-black/10'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Website, Brand & CMS
            </button>
            <button
              type="button"
              onClick={() => setSubTab('business')}
              className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
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
            className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
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
            className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
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
              {/* 1. Business Brand, Theme Colors & Identity */}
              <div className="bg-white border border-black/10 rounded-xl p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">1. Brand Identity, Theme Palette & Logos</h2>
                  </div>
                  <span className="text-[11px] font-medium text-slate-muted">
                    Propagates live to Header, Footer, Favicon & CSS Theme Tokens
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Company Name *</label>
                    <input
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Storefront Brand Display Name</label>
                    <input
                      type="text"
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value)}
                      placeholder="e.g. EliteDrive Car Rentals"
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Browser Tab &lt;title&gt;</label>
                    <input
                      type="text"
                      value={websiteTitle}
                      onChange={(e) => setWebsiteTitle(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Default Storefront Language</label>
                    <select
                      value={defaultLanguage}
                      onChange={(e) => setDefaultLanguage(e.target.value as SupportedLanguage)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                    >
                      <option value="en">English (EN)</option>
                      <option value="hi">हिंदी (Hindi)</option>
                      <option value="mr">मराठी (Marathi)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Primary Gold / Accent Hex</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={/^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : '#C8A24D'}
                        onChange={(e) => setPrimaryColor(e.target.value.toUpperCase())}
                        className="w-10 h-9 rounded border border-black/15 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="flex-1 px-3 py-2 border border-black/15 rounded-lg font-mono uppercase"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Secondary Dark Navy Surface Hex</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={/^#[0-9A-Fa-f]{6}$/.test(secondaryColor) ? secondaryColor : '#0F1420'}
                        onChange={(e) => setSecondaryColor(e.target.value.toUpperCase())}
                        className="w-10 h-9 rounded border border-black/15 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={secondaryColor}
                        onChange={(e) => setSecondaryColor(e.target.value)}
                        className="flex-1 px-3 py-2 border border-black/15 rounded-lg font-mono uppercase"
                      />
                    </div>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3 grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Short Description (Hero & Meta)</label>
                      <input
                        type="text"
                        value={shortDescription}
                        onChange={(e) => setShortDescription(e.target.value)}
                        placeholder="Curated self-drive vehicles with transparent tariffs across India."
                        className="w-full px-3 py-2 border border-black/15 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Legal Registration / GSTIN Info</label>
                      <input
                        type="text"
                        value={registrationInfo}
                        onChange={(e) => setRegistrationInfo(e.target.value)}
                        className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                      />
                    </div>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block font-semibold text-slate-muted mb-1">Full Brand Editorial Description</label>
                    <textarea
                      rows={2}
                      value={fullDescription}
                      onChange={(e) => setFullDescription(e.target.value)}
                      placeholder="Complete brand positioning paragraph used on About Us and corporate fleet pages."
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
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
                    <input
                      type="text"
                      value={logoUrl.startsWith('data:') ? '' : logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                      placeholder="Or paste https://... logo URL"
                      className="w-full px-3 py-1.5 bg-white border border-black/15 rounded-lg"
                    />
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
                    <input
                      type="text"
                      value={faviconUrl.startsWith('data:') ? '' : faviconUrl}
                      onChange={(e) => setFaviconUrl(e.target.value)}
                      placeholder="Or paste https://... favicon URL"
                      className="w-full px-3 py-1.5 bg-white border border-black/15 rounded-lg"
                    />
                    {faviconUrl && <img src={faviconUrl} alt="Favicon Preview" className="w-8 h-8 object-contain bg-white p-1 rounded border border-black/10" />}
                  </div>
                </div>
              </div>

              {/* 2. Office Showcase & Dynamic 12-Platform Social Media Builder */}
              <div className="grid lg:grid-cols-12 gap-6">
                <div className="lg:col-span-4 bg-white border border-black/10 rounded-xl p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-xl font-semibold">2. Showroom Images</h2>
                    <label className="px-3 py-1.5 bg-alabaster border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1 cursor-pointer hover:border-gold">
                      <Upload className="w-3.5 h-3.5 text-gold-hover" /> Upload
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
                  <div className="grid grid-cols-2 gap-2">
                    {officeImages.map((img, i) => (
                      <div key={i} className="relative rounded-lg overflow-hidden border border-black/10">
                        <img
                          src={resolveVehicleImage(img)}
                          alt={`Office ${i + 1}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-24 object-cover"
                        />
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

                <div className="lg:col-span-8 bg-white border border-black/10 rounded-xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Share2 className="w-4 h-4 text-gold-hover" />
                      <h2 className="font-display text-xl font-semibold">
                        3. Social Media Builder ({socialProfiles.filter((s) => s.enabled).length} Active)
                      </h2>
                    </div>
                    <span className="text-[11px] text-slate-muted">
                      Only enabled links appear in Customer Footer & Contact sections.
                    </span>
                  </div>

                  {/* Add Social Link Form */}
                  <div className="grid sm:grid-cols-12 gap-2 p-3 rounded-xl bg-alabaster border border-black/10">
                    <select
                      value={newSocialPlatform}
                      onChange={(e) => {
                        const key = e.target.value as SocialPlatformKey;
                        setNewSocialPlatform(key);
                        const match = SOCIAL_PLATFORMS.find((p) => p.key === key);
                        if (match) setNewSocialLabel(match.label);
                      }}
                      className="sm:col-span-3 px-2.5 py-2 bg-white border border-black/15 rounded-lg font-medium"
                    >
                      {SOCIAL_PLATFORMS.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Display Label"
                      value={newSocialLabel}
                      onChange={(e) => setNewSocialLabel(e.target.value)}
                      className="sm:col-span-3 px-2.5 py-2 bg-white border border-black/15 rounded-lg"
                    />
                    <input
                      type="url"
                      placeholder={SOCIAL_PLATFORMS.find((p) => p.key === newSocialPlatform)?.placeholder || 'https://...'}
                      value={newSocialUrl}
                      onChange={(e) => setNewSocialUrl(e.target.value)}
                      className="sm:col-span-4 px-2.5 py-2 bg-white border border-black/15 rounded-lg font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleAddSocialProfile}
                      className="sm:col-span-2 px-3 py-2 bg-obsidian text-gold font-semibold rounded-lg inline-flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Social
                    </button>
                  </div>

                  {socialProfiles.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-black/15 text-center text-slate-muted">
                      No social profiles added yet. When empty or all disabled, social icons stay hidden on the storefront.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {socialProfiles.map((item, idx) => (
                        <div
                          key={item.id}
                          className={`grid sm:grid-cols-12 gap-2 items-center p-2.5 rounded-xl border ${
                            item.enabled ? 'bg-white border-black/10' : 'bg-alabaster/70 border-black/10 opacity-70'
                          }`}
                        >
                          <div className="sm:col-span-2 font-semibold uppercase tracking-wider text-[11px] text-ink">
                            {item.platform}
                          </div>
                          <input
                            type="text"
                            value={item.displayName}
                            onChange={(e) =>
                              setSocialProfiles((prev) =>
                                prev.map((p) => (p.id === item.id ? { ...p, displayName: e.target.value } : p))
                              )
                            }
                            className="sm:col-span-3 px-2.5 py-1.5 bg-alabaster border border-black/10 rounded-lg"
                          />
                          <input
                            type="text"
                            value={item.url}
                            onChange={(e) =>
                              setSocialProfiles((prev) =>
                                prev.map((p) => (p.id === item.id ? { ...p, url: e.target.value } : p))
                              )
                            }
                            className="sm:col-span-4 px-2.5 py-1.5 bg-alabaster border border-black/10 rounded-lg font-mono"
                          />
                          <div className="sm:col-span-3 flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => moveSocialProfile(idx, -1)}
                              disabled={idx === 0}
                              className="p-1.5 rounded border border-black/10 hover:border-gold disabled:opacity-30 cursor-pointer"
                              title="Move Up"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSocialProfile(idx, 1)}
                              disabled={idx === socialProfiles.length - 1}
                              className="p-1.5 rounded border border-black/10 hover:border-gold disabled:opacity-30 cursor-pointer"
                              title="Move Down"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setSocialProfiles((prev) =>
                                  prev.map((p) => (p.id === item.id ? { ...p, enabled: !p.enabled } : p))
                                )
                              }
                              className={`p-1.5 rounded border cursor-pointer ${
                                item.enabled
                                  ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                                  : 'border-black/15 text-slate-muted bg-white'
                              }`}
                              title={item.enabled ? 'Visible on site (click to hide)' : 'Hidden (click to enable)'}
                            >
                              {item.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setSocialProfiles((prev) => prev.filter((p) => p.id !== item.id))}
                              className="p-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                              title="Delete Link"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Multilingual Storefront Copy, Policies, How It Works & FAQs */}
              <div className="bg-white border border-black/10 rounded-xl p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Languages className="w-4 h-4 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">
                      4. Multilingual Storefront Copy, Policies & Help Content
                    </h2>
                  </div>
                  <div className="flex items-center gap-1 p-1 bg-alabaster rounded-lg border border-black/10">
                    {CMS_LANGUAGES.map((langOpt) => (
                      <button
                        key={langOpt.code}
                        type="button"
                        onClick={() => setCmsLang(langOpt.code)}
                        className={`px-3 py-1.5 rounded-md font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                          cmsLang === langOpt.code
                            ? 'bg-obsidian text-gold'
                            : 'text-slate-muted hover:text-ink'
                        }`}
                      >
                        {langOpt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {cmsLang !== 'en' && (
                  <p className="text-[11px] bg-alabaster border border-black/10 rounded-lg px-3 py-2 text-slate-muted">
                    Editing <strong>{cmsLang === 'hi' ? 'Hindi (हिंदी)' : 'Marathi (मराठी)'}</strong> storefront overrides. Any field left blank automatically falls back to your English copy or built-in translations.
                  </p>
                )}

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Brand Tagline ({cmsLang.toUpperCase()})</label>
                    <input
                      type="text"
                      value={activeCopyFieldValue('tagline')}
                      onChange={(e) => setActiveCopyFieldValue('tagline', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Hero Banner Headline ({cmsLang.toUpperCase()})</label>
                    <input
                      type="text"
                      value={activeCopyFieldValue('heroBannerHeadline')}
                      onChange={(e) => setActiveCopyFieldValue('heroBannerHeadline', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-muted mb-1">Hero Subcopy ({cmsLang.toUpperCase()})</label>
                    <textarea
                      rows={2}
                      value={activeCopyFieldValue('heroBannerSubcopy')}
                      onChange={(e) => setActiveCopyFieldValue('heroBannerSubcopy', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Fleet Section Heading ({cmsLang.toUpperCase()})</label>
                    <input
                      type="text"
                      value={activeCopyFieldValue('fleetSectionHeading')}
                      onChange={(e) => setActiveCopyFieldValue('fleetSectionHeading', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Offers Section Heading ({cmsLang.toUpperCase()})</label>
                    <input
                      type="text"
                      value={activeCopyFieldValue('offersSectionHeading')}
                      onChange={(e) => setActiveCopyFieldValue('offersSectionHeading', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Footer Tagline ({cmsLang.toUpperCase()})</label>
                    <input
                      type="text"
                      value={activeCopyFieldValue('footerTagline')}
                      onChange={(e) => setActiveCopyFieldValue('footerTagline', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Hero Background Image (URL/Preset)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={heroBannerImage.startsWith('data:') ? '' : heroBannerImage}
                        onChange={(e) => setHeroBannerImage(e.target.value)}
                        className="flex-1 px-3 py-2 border border-black/15 rounded-lg"
                      />
                      <label className="px-3 py-2 bg-alabaster border border-black/15 rounded-lg cursor-pointer font-semibold">
                        Upload
                        <input type="file" accept="image/*" onChange={(e) => handleFileDataUrl(e, setHeroBannerImage)} className="hidden" />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">About Us Summary ({cmsLang.toUpperCase()})</label>
                    <textarea
                      rows={2}
                      value={activeCopyFieldValue('aboutSummary')}
                      onChange={(e) => setActiveCopyFieldValue('aboutSummary', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">How It Works Intro ({cmsLang.toUpperCase()})</label>
                    <textarea
                      rows={2}
                      value={activeCopyFieldValue('howItWorksSummary')}
                      onChange={(e) => setActiveCopyFieldValue('howItWorksSummary', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Terms & Conditions ({cmsLang.toUpperCase()})</label>
                    <textarea
                      rows={2}
                      value={activeCopyFieldValue('termsSummary')}
                      onChange={(e) => setActiveCopyFieldValue('termsSummary', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Privacy Policy ({cmsLang.toUpperCase()})</label>
                    <textarea
                      rows={2}
                      value={activeCopyFieldValue('privacySummary')}
                      onChange={(e) => setActiveCopyFieldValue('privacySummary', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Cancellation Policy ({cmsLang.toUpperCase()})</label>
                    <textarea
                      rows={2}
                      value={activeCopyFieldValue('cancellationSummary')}
                      onChange={(e) => setActiveCopyFieldValue('cancellationSummary', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Refund Policy ({cmsLang.toUpperCase()})</label>
                    <textarea
                      rows={2}
                      value={activeCopyFieldValue('refundSummary')}
                      onChange={(e) => setActiveCopyFieldValue('refundSummary', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Self-Drive Rental Rules ({cmsLang.toUpperCase()})</label>
                    <textarea
                      rows={2}
                      value={activeCopyFieldValue('rentalRulesSummary')}
                      onChange={(e) => setActiveCopyFieldValue('rentalRulesSummary', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Payment Information Policy ({cmsLang.toUpperCase()})</label>
                    <textarea
                      rows={2}
                      value={activeCopyFieldValue('paymentInfoSummary')}
                      onChange={(e) => setActiveCopyFieldValue('paymentInfoSummary', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                </div>

                {/* How It Works Steps */}
                <div className="pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-ink">How It Works Journey Steps ({howItWorksSteps.length})</p>
                    <button
                      type="button"
                      onClick={() => setHowItWorksSteps((prev) => [...prev, { title: '', description: '' }])}
                      className="text-gold-hover font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Step
                    </button>
                  </div>
                  {howItWorksSteps.map((step, idx) => (
                    <div key={idx} className="grid sm:grid-cols-12 gap-2 p-2.5 rounded-lg bg-alabaster border border-black/10">
                      <input
                        type="text"
                        placeholder={`Step ${idx + 1} Title`}
                        value={step.title}
                        onChange={(e) =>
                          setHowItWorksSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, title: e.target.value } : s))
                          )
                        }
                        className="sm:col-span-4 px-2.5 py-1.5 bg-white border border-black/15 rounded"
                      />
                      <input
                        type="text"
                        placeholder="Step description"
                        value={step.description}
                        onChange={(e) =>
                          setHowItWorksSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, description: e.target.value } : s))
                          )
                        }
                        className="sm:col-span-7 px-2.5 py-1.5 bg-white border border-black/15 rounded"
                      />
                      <button
                        type="button"
                        onClick={() => setHowItWorksSteps((prev) => prev.filter((_, i) => i !== idx))}
                        className="sm:col-span-1 flex items-center justify-center text-red-700 cursor-pointer"
                        aria-label="Remove Step"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* FAQs */}
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
                      <label className="block font-semibold text-slate-muted mb-1">WhatsApp Support Number (Floating Icon)</label>
                      <input type="text" placeholder="Leave blank to hide floating icon" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
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
              className="px-6 py-3 bg-obsidian text-white font-semibold rounded-xl hover:bg-graphite inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
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
