import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Booking, CompanySettings } from '../types';

function inrText(val: number | undefined | null): string {
  const num = Math.round(Number(val || 0));
  return `INR ${num.toLocaleString('en-IN')}`;
}

export function downloadBookingInvoicePdf(
  booking: Booking,
  settings?: CompanySettings | null
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const companyName = settings?.companyName || 'EliteDrive';
  const legalInfo =
    settings?.registrationInfo || 'EliteDrive Mobility Pvt. Ltd.';
  const supportEmail = settings?.supportEmail || 'concierge@elitedrive.in';
  const supportPhone = settings?.supportPhone || '+91 22 4890 2200';
  const cityName = settings?.operatingCityName || booking.cityName || 'Operating Hub';

  // Obsidian header banner
  doc.setFillColor(11, 11, 13);
  doc.rect(0, 0, 210, 36, 'F');
  doc.setDrawColor(200, 162, 77);
  doc.setLineWidth(0.7);
  doc.line(14, 31, 196, 31);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(companyName.toUpperCase(), 14, 15);

  doc.setTextColor(200, 162, 77);
  doc.setFontSize(9);
  doc.text('TAX INVOICE & SELF-DRIVE RENTAL RECEIPT', 14, 22);

  doc.setTextColor(220, 220, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Ref: ${booking.bookingReference}`, 196, 14, { align: 'right' });
  doc.text(
    `Issued: ${new Date(booking.createdAt).toLocaleDateString('en-IN')}`,
    196,
    20,
    { align: 'right' }
  );
  doc.text(`Status: ${booking.status} / ${booking.paymentStatus}`, 196, 26, {
    align: 'right',
  });

  // Company & Customer block
  doc.setTextColor(17, 17, 21);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('BILLED BY', 14, 46);
  doc.text('BILLED TO', 110, 46);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(70, 72, 82);
  doc.text(legalInfo, 14, 52, { maxWidth: 88 });
  doc.text(
    `${settings?.businessAddress || `${cityName} Central Operating Hub`}`,
    14,
    60,
    { maxWidth: 88 }
  );
  doc.text(`Phone: ${supportPhone} | ${supportEmail}`, 14, 70);

  doc.setTextColor(17, 17, 21);
  doc.setFont('helvetica', 'bold');
  doc.text(booking.customerName || 'Customer', 110, 52);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(70, 72, 82);
  doc.text(`Email: ${booking.customerEmail || '—'}`, 110, 58);
  doc.text(`Phone: ${booking.customerPhone || '—'}`, 110, 64);
  if (booking.gstNumber) {
    doc.text(`Customer GSTIN: ${booking.gstNumber}`, 110, 70);
  }

  // Trip & Vehicle Summary
  autoTable(doc, {
    startY: 78,
    head: [['Trip & Vehicle Particulars', 'Details']],
    body: [
      ['Vehicle', `${booking.vehicleName} (${booking.vehicleCategory})`],
      [
        'Rental Window',
        `${new Date(booking.startDate).toLocaleString('en-IN')} to ${new Date(
          booking.endDate
        ).toLocaleString('en-IN')} (${booking.pricing.durationDays}d / ${
          booking.pricing.durationHours
        }h)`,
      ],
      [
        'Handover Mode',
        booking.pickupMode === 'delivery'
          ? 'Doorstep Delivery & Pickup'
          : `Hub Self-Pickup (${booking.branchName || cityName})`,
      ],
      ['Pickup Location', booking.pickupAddress || '—'],
      ['Return Location', booking.returnAddress || '—'],
      [
        'Included KM / Extra KM Rate',
        `${booking.pricing.includedKmAllowance} km included (${inrText(
          booking.pricing.extraKmRate
        )}/km extra)`,
      ],
      [
        'Payment Method & Documents',
        `${booking.paymentMethod} | Verification: ${booking.kycStatusSnapshot}`,
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [20, 20, 24], textColor: [200, 162, 77], fontSize: 8.5 },
    bodyStyles: { fontSize: 8, textColor: [25, 25, 30] },
    columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' } },
  });

  const p = booking.pricing;
  const pricingRows: (string | number)[][] = [
    ['Base Rental Charges', inrText(p.baseRentalAmount)],
  ];
  if (p.weekendSurcharge > 0) {
    pricingRows.push(['Weekend Peak Surcharge', inrText(p.weekendSurcharge)]);
  }
  if (p.deliveryCharge > 0) {
    pricingRows.push(['Doorstep Delivery Fee', inrText(p.deliveryCharge)]);
  }
  if (p.insuranceCharge > 0) {
    pricingRows.push([
      `Protection Plan (${booking.insurancePackageName || 'Coverage'})`,
      inrText(p.insuranceCharge),
    ]);
  }
  if (p.roadsideCharge > 0) {
    pricingRows.push(['24x7 Roadside Concierge Add-on', inrText(p.roadsideCharge)]);
  }
  if (p.driverCharge > 0) {
    pricingRows.push(['Chauffeur Driver Add-on', inrText(p.driverCharge)]);
  }
  if (p.couponDiscount > 0) {
    pricingRows.push([
      `Promotional Coupon Discount (${p.couponCode || 'APPLIED'})`,
      `- ${inrText(p.couponDiscount)}`,
    ]);
  }
  pricingRows.push([`GST (${p.taxRatePercent}%)`, inrText(p.taxAmount)]);
  pricingRows.push([
    'Refundable Security Deposit',
    inrText(p.securityDeposit),
  ]);
  if ((p.lateReturnFee || 0) > 0) {
    pricingRows.push(['Late Return Fee', inrText(p.lateReturnFee)]);
  }
  if ((p.penalties || 0) > 0) {
    pricingRows.push(['Extra KM / Damage Penalties', inrText(p.penalties)]);
  }
  pricingRows.push(['Total Booking Payable (Incl. Deposit)', inrText(p.totalPayable)]);
  pricingRows.push(['Advance / Paid Now', inrText(p.amountDueNow)]);
  pricingRows.push(['Remaining Balance at Pickup', inrText(p.balanceDueAtPickup)]);

  const afterFirstTable = (doc as any).lastAutoTable?.finalY || 145;
  autoTable(doc, {
    startY: afterFirstTable + 8,
    head: [['Charges & Tax Breakdown', 'Amount']],
    body: pricingRows,
    theme: 'striped',
    headStyles: { fillColor: [11, 11, 13], textColor: [255, 255, 255], fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5, textColor: [20, 20, 25] },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 240;
  doc.setFontSize(7.5);
  doc.setTextColor(100, 102, 112);
  doc.text(
    'This is a computer-generated invoice issued by EliteDrive Self-Drive Mobility. Security deposit refunds settle within 3-5 business days after clean return inspection.',
    14,
    Math.min(282, finalY + 12),
    { maxWidth: 182 }
  );

  doc.save(`invoice-${booking.bookingReference.toLowerCase()}.pdf`);
}

export function downloadAnalyticsReportPdf(params: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: (string | number)[][];
  filename: string;
  settings?: CompanySettings | null;
}): void {
  const doc = new jsPDF({
    orientation: params.headers.length > 6 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const companyName = params.settings?.companyName || 'EliteDrive';

  doc.setFillColor(11, 11, 13);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`${companyName.toUpperCase()} — ${params.title}`, 14, 12);

  doc.setTextColor(200, 162, 77);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    `${params.subtitle} | Generated ${new Date().toLocaleString('en-IN')}`,
    14,
    20
  );

  autoTable(doc, {
    startY: 34,
    head: [params.headers],
    body: params.rows.map((r) => r.map((c) => String(c ?? ''))),
    theme: 'grid',
    headStyles: { fillColor: [20, 20, 24], textColor: [200, 162, 77], fontSize: 7.5 },
    bodyStyles: { fontSize: 7.5, textColor: [25, 25, 30] },
  });

  doc.save(params.filename);
}

export function downloadRentalAgreementPdf(
  booking: Booking,
  settings?: CompanySettings | null
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const companyName = settings?.companyName || 'EliteDrive';
  const legalInfo = settings?.registrationInfo || 'EliteDrive Mobility Pvt. Ltd.';
  const supportPhone = settings?.supportPhone || '+91 22 4890 2200';
  const supportEmail = settings?.supportEmail || 'concierge@elitedrive.in';
  const regs =
    Array.isArray(booking.assignedVehicleRegs) && booking.assignedVehicleRegs.length > 0
      ? booking.assignedVehicleRegs.join(', ')
      : booking.vehicleId;

  doc.setFillColor(11, 11, 13);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setDrawColor(200, 162, 77);
  doc.setLineWidth(0.7);
  doc.line(14, 29, 196, 29);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(companyName.toUpperCase(), 14, 14);
  doc.setTextColor(200, 162, 77);
  doc.setFontSize(9);
  doc.text('SELF-DRIVE VEHICLE RENTAL AGREEMENT', 14, 22);

  doc.setTextColor(220, 220, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Booking Ref: ${booking.bookingReference}`, 196, 13, { align: 'right' });
  doc.text(`Agreement Ver: ${booking.rentalAgreementVersion || 'v2025.1'}`, 196, 19, { align: 'right' });
  doc.text(
    `Accepted: ${booking.rentalAgreementAcceptedAt ? new Date(booking.rentalAgreementAcceptedAt).toLocaleString('en-IN') : new Date(booking.createdAt).toLocaleString('en-IN')}`,
    196,
    25,
    { align: 'right' }
  );

  autoTable(doc, {
    startY: 40,
    head: [['Contract Parties & Fleet Allocation', 'Particulars']],
    body: [
      ['Lessor (Operator)', `${legalInfo} (${settings?.businessAddress || booking.branchName})`],
      ['Operator Contact', `${supportPhone} | ${supportEmail}`],
      ['Lessee (Customer)', `${booking.customerName} (${booking.customerEmail}${booking.customerPhone ? ` | ${booking.customerPhone}` : ''})`],
      ['Document Verification Snapshot', booking.kycStatusSnapshot],
      ['Vehicle Model & Category', `${booking.vehicleName} (${booking.vehicleCategory})`],
      ['Units Booked & Reg. Numbers', `${booking.quantity || 1} unit(s) — ${regs}`],
      ['Pickup Window', new Date(booking.startDate).toLocaleString('en-IN')],
      ['Return Window', new Date(booking.endDate).toLocaleString('en-IN')],
      ['Pickup Handover Address', `${booking.pickupMode === 'delivery' ? 'Doorstep Delivery: ' : 'Hub Pickup: '}${booking.pickupAddress}`],
      ['Return Handover Address', booking.returnAddress || booking.pickupAddress],
      ['Pricing & Deposit Summary', `Total Payable: ${inrText(booking.pricing.totalPayable)} | Deposit Held: ${inrText(booking.pricing.securityDeposit)} | KM Allowance: ${booking.pricing.includedKmAllowance} km (${inrText(booking.pricing.extraKmRate)}/km extra)`],
      ...(Array.isArray(booking.accessoriesChecklist) && booking.accessoriesChecklist.length > 0
        ? [['Handover Accessories Verified', booking.accessoriesChecklist.join(', ')]]
        : []),
    ],
    theme: 'grid',
    headStyles: { fillColor: [20, 20, 24], textColor: [200, 162, 77], fontSize: 8.5 },
    bodyStyles: { fontSize: 8, textColor: [25, 25, 30] },
    columnStyles: { 0: { cellWidth: 58, fontStyle: 'bold' } },
  });

  const afterTableY = (doc as any).lastAutoTable?.finalY || 175;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(17, 17, 21);
  doc.text('KEY SELF-DRIVE TERMS & COVENANTS', 14, afterTableY + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(65, 67, 77);
  const terms = [
    '1. Valid original Driving Licence and identity document clearance must be presented prior to key & OTP handover.',
    '2. Fuel must be returned at the same level as recorded during handover inspection (Full-to-Full policy unless noted).',
    '3. Excess kilometres beyond included allowance and unapproved late returns attract standard tariff charges.',
    '4. The vehicle shall not be used for commercial sub-leasing, racing, hazardous cargo, or outside permitted jurisdiction.',
    '5. Refundable security deposit settles within 3-5 business days post return inspection minus verified deductions.',
  ];
  let cursorY = afterTableY + 16;
  for (const line of terms) {
    doc.text(line, 14, cursorY, { maxWidth: 182 });
    cursorY += 6;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(17, 17, 21);
  doc.text('Digitally Accepted by Customer at Checkout', 14, Math.min(278, cursorY + 10));
  doc.text('Authorized Fleet Operations Signatory', 130, Math.min(278, cursorY + 10));

  doc.save(`rental-agreement-${booking.bookingReference.toLowerCase()}.pdf`);
}

