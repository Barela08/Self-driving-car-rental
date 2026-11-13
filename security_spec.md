# Security Specification & Threat Audit (Firestore Rules TDD)

## 1. Data Invariants
1. **Identity Integrity**: Every user-owned document (`users/{uid}/private/info`, `kyc_verifications`, `bookings`, `roadside_requests`, `support_tickets`, `notifications`) must bind `userId == request.auth.uid` on creation and never allow transferring ownership.
2. **Role Escalation Guard**: No user may set or alter `role`, `branchId`, or `accountStatus` on `users/{uid}` or `staff_roles/{uid}` during client registration or profile update. Only verified Super Admins (or server-side Firebase Admin SDK) may manage staff roles.
3. **PII Isolation**: Sensitive customer PII (`email`, `phone`, `savedAddresses`, KYC license/ID numbers, and private document references) are stored only in `users/{uid}/private/{docId}` and `kyc_verifications/{kycId}`, readable exclusively by the document owner or authorized staff/admins — never via blanket `isSignedIn()` reads.
4. **Booking & Payment Integrity**: Clients cannot mark `paymentStatus: "Paid"`, `status: "Confirmed"`, or `kycStatus: "Verified"` directly on Firestore documents; critical financial, booking-lock, and inspection state transitions run exclusively through server-verified endpoints using Firebase Admin SDK transactions.
5. **Path & Size Guards**: Every document ID matches `^[a-zA-Z0-9_\-]+$` (max 128 chars), and every string/array field enforces strict `.size()` bounds.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Self-Role Escalation on Create**: `POST /users/{uid}` with `{ role: "super_admin", accountStatus: "active" }` -> Denied (client cannot self-assign privileged roles).
2. **Ghost Field / Shadow Update**: `PATCH /users/{uid}/private/info` with `{ phone: "+919999999999", isKycVerified: true }` -> Denied (`hasOnly` rejects unknown fields).
3. **Cross-User PII Read (IDOR)**: `GET /users/{otherUid}/private/info` as non-owner customer -> Denied.
4. **Blanket Collection Scrape**: `LIST /bookings` as standard customer without `where("userId", "==", uid)` -> Denied (`resource.data.userId == request.auth.uid` required).
5. **Payment Status Spoofing**: `PATCH /bookings/{id}` by owner with `{ paymentStatus: "Paid", status: "Confirmed" }` -> Denied (client cannot modify payment or confirmation status).
6. **KYC Self-Approval**: `PATCH /kyc_verifications/{kycId}` by owner with `{ status: "Verified" }` -> Denied.
7. **ID Poisoning**: `GET /vehicles/<1500-char-id>` -> Denied (`isValidId` max 128 chars).
8. **Type Poisoning**: `POST /support_tickets/{id}` with `{ subject: 12345, message: ["bad"] }` -> Denied.
9. **Terminal State Mutation**: `PATCH /bookings/{id}` when `existing().status == "Completed"` by non-admin -> Denied.
10. **Immutable Timestamp Tampering**: `POST /support_tickets/{id}` with backdated `createdAt` not matching `request.time` -> Denied.
11. **Unverified / Anonymous Spoof**: Write attempt without `request.auth != null` -> Denied.
12. **Public Vehicle Private-Doc Read**: `GET /vehicle_private/{vehicleId}` (containing registration/VIN/insurance doc refs) as unauthenticated or customer -> Denied.
13. **WhatsApp OTP Client Read**: `GET /whatsapp_otp_challenges/{id}` by any client (even Admin) -> Denied (OTP hashes are strictly server-only).
14. **UPI Payment Proof Self-Approval**: `PATCH /payment_proofs/{id}` with `{ status: "Approved" }` by customer -> Denied.
15. **Notification Log Token/OTP Leakage**: `notification_logs` contains zero plaintext OTPs and zero Meta access tokens; writes restricted to server/Cloud Functions.
16. **Payment Audit Log Tampering**: `POST /payment_audit_logs/{id}` or client write to `payment_audit_logs` -> Denied (server-only immutable financial audit trail).
