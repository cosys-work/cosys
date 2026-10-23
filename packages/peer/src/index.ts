/**
 * `@cosys/peer` — everything ADR-14 §3 says is the same on either transport.
 *
 * It ships in 1.0 (ADR-11 §The peer network, as amended 2026-09-19), behind each app's one door
 * (`src/lib/peer.ts` in each app). It names no modality: which kinds exist, which travel and which
 * views a grant may name are the registries' in `@cosys/record` (2026-10-21, 2026-10-22).
 *
 * @module
 */

export type { DeviceIdentity, SessionKeys, HandshakeHalf } from './identity.ts';
export {
  certifyTransportKey,
  deriveSessionKeys,
  deriveTransportSeed,
  identityFromSeed,
  signHello,
  verifyHello,
  verifyTransportCertificate,
} from './identity.ts';

// The views a grant may name are registered by modalities (`@cosys/record/views`); the health
// ones, and the band arithmetic behind them, are `@tapp/record`'s `views.ts` since 2026-10-22.
// What the substrate itself has: the full view, and the questions every view answers.
export type { RowView, RowView as PeerView, ViewContext } from './deps.ts';
export { FULL_VIEW, projectsItself, scopeKindsOf } from './deps.ts';

export type { ConfirmationCode, ConfirmationEmoji, PairingInvite, PairingMessage } from './pairing.ts';
export { CONFIRMATION_GLYPH, glyphFor } from './glyphs.ts';
export {
  CONFIRMATION_DIGITS,
  CONFIRMATION_EMOJI,
  CONFIRMATION_EMOJI_COUNT,
  confirmationCode,
  createPairingNonce,
  decodePairingInvite,
  decodePairingMessage,
  encodePairingInvite,
  encodePairingMessage,
  MAX_PAIRING_NAME_BYTES,
  opensCommitment,
  pairingCommitment,
  pairingConfirmation,
  PAIRING_NONCE_BYTES,
  PAIRING_URI_PREFIX,
} from './pairing.ts';

export type { Cursor, Message, SyncEntry, AttachmentBody } from './messages.ts';
export { MESSAGE_TYPE, ProtocolError, syncEntrySchema, VIEW_NAME_MAX_LENGTH } from './messages.ts';

export type { PeerStore, RowApplyResult } from './store.ts';
export { createMemoryStore } from './store.ts';

export type { ConnectionPath, PeerStream, PeerTransport } from './transport.ts';
export { PeerStreamError } from './transport.ts';

export type { SessionOptions, SyncResult } from './session.ts';
export { runSession } from './session.ts';

export type {
  Mailbox,
  MailboxAddress,
  MailboxDelivery,
  MailboxItem,
  MailboxKey,
  MailboxReceipt,
} from './mailbox.ts';
export {
  addressOf,
  createMemoryMailbox,
  mailboxKey,
  openFromMailbox,
  sealForMailbox,
} from './mailbox.ts';

export type { CouchClientOptions, TokenSource } from './couch/client.ts';
export { CouchClient, CouchError } from './couch/client.ts';
export type { CouchMailboxOptions, MailboxScope } from './couch/mailbox.ts';
export { createCouchMailbox, mailboxDatabaseName, MAX_DEPOSIT_BYTES } from './couch/mailbox.ts';
export type {
  ErasureAnswer,
  MailboxRole,
  MailboxTarget,
  ProvisioningClient,
  ProvisioningOptions,
  SigningKey,
} from './couch/provisioning.ts';
export {
  createProvisioningClient,
  PILOT_MAILBOX_PREFIX,
  pilotMailboxName,
  ProvisioningError,
} from './couch/provisioning.ts';
export type { PilotClient, PilotClientOptions, PilotDepositResult } from './couch/pilot.ts';
export { createPilotClient, openPilotFrame, sealPilotFrame } from './couch/pilot.ts';

export type { GrantPayload, GrantState } from './grants.ts';
export {
  createGrant,
  grantPayloadSchema,
  grantView,
  resolveGrant,
  resolveGrantState,
  viewForState,
} from './grants.ts';

export type {
  RevocationMode,
  RevocationPayload,
  RevocationReport,
  RevocationScope,
} from './revocation.ts';
export {
  applyRevocation,
  createRevocation,
  honourRevocations,
  REVOCATION_MODES,
  revocationPayloadSchema,
} from './revocation.ts';

export type {
  ErasureHolder,
  ErasureReceiptPayload,
  ErasureRequestPayload,
  ErasureState,
  ErasureStatus,
  HolderDetails,
} from './erasure.ts';
export {
  createErasureRequest,
  ERASURE_ANSWER_DAYS,
  erasureRequestDigest,
  erasureRoute,
  honourErasure,
  pendingErasures,
  readErasureReceipt,
  readErasureRequest,
  receiptRequestId,
  receiptRoute,
  resolveErasures,
} from './erasure.ts';

// Who may deposit into this account's mailboxes, folded from its own log (ADR-16, 2026-09-24).
export { DEPOSIT_ANSWER_WINDOW_DAYS, depositAllowlist } from './deposits.ts';

// The clinic-shaped peer (ADR-17 §1). Exported from the package for its own tests and for the
// clinic node; `scripts/check-peer-fence.mjs` fails if any of these names appears under `src/`.
export type {
  ClinicDirectoryEntry,
  ClinicEntryProblem,
  ClinicInvite,
  ClinicShare,
  SignedClinicEntry,
} from './clinic.ts';
export {
  CLINIC_CONSENT_VERSION,
  CLINIC_ENTRY_MAX_DAYS,
  CLINIC_INVITE_PREFIX,
  clinicEntryBytes,
  clinicEntryProblem,
  clinicGrant,
  decodeClinicInvite,
  encodeClinicInvite,
} from './clinic.ts';

// The clinic's signed rows and the patient's replies (ADR-20 §4, §6; PLAN M14-1) are the clinic
// modality's code, `@tapp/record`'s `clinic-rows.ts` since 2026-10-22.

// A bridge's signed rows (ADR-22 §3; PLAN M19-2): the bridge signs, the patient's phone checks.
export type { BridgeRowHeader, BridgeRowRefusal, BridgeSigner } from './bridge-rows.ts';
export {
  bridgeInstanceSeed,
  readBridgeReceipt,
  signBridgeRow,
  verifyBridgeRow,
} from './bridge-rows.ts';
// Pairing a bridge: the operator's signed entry, and what the phone's check takes (PLAN M19-3).
export type {
  BridgeDirectoryEntry,
  BridgeEntryProblem,
  BridgeInvite,
  SignedBridgeEntry,
} from './bridge-directory.ts';
export {
  BRIDGE_ENTRY_MAX_DAYS,
  BRIDGE_INVITE_PREFIX,
  decodeBridgeInvite,
  encodeBridgeInvite,
  bridgeEntryBytes,
  bridgeEntryProblem,
  bridgeOfAssertion,
  bridgePairingAssertion,
  pairedBridges,
  PAIRING_CODE,
  pairingCodeDigest,
} from './bridge-directory.ts';

// Assertions (ADR-23 §5; PLAN M20-4): signed claims with no number in them.
export type { AssertionContext, AssertionRefusal } from './assertions.ts';
export { licensedClinicAssertion, signAssertion, verifyAssertion } from './assertions.ts';

export type {
  DirectoryClient,
  DirectoryIntake,
  DirectoryRecord,
  DirectoryClientOptions,
} from './directory.ts';
export { createDirectoryClient, signDirectoryRecord, verifyDirectoryRecord } from './directory.ts';

export type {
  IrohBiStream,
  IrohBinding,
  IrohConnection,
  IrohEndpoint,
  IrohTransport,
  IrohTransportOptions,
} from './iroh.ts';
export { createIrohTransport, IROH_TRANSPORT_LABEL, irohEndpointId } from './iroh.ts';

export type { RelayAccessKey } from './relay-access.ts';
export {
  parseRelayAccessKey,
  RELAY_ACCESS_VERSION,
  RELAY_TOKEN_PARAM,
  relayAccessToken,
  withRelayAccess,
} from './relay-access.ts';

export type {
  IntegrityProvider,
  RelayAccessEvent,
  RelayAccessMode,
  RelayPassCache,
  RelayAccessClientOptions,
  HeldPass,
  RelayAccessRoutes,
  RelayPassGrant,
  RelayPassStore,
  RelayTokenSource,
  RelayTokenSourceOptions,
} from './relay-pass.ts';
export {
  createRelayAccessClient,
  createRelayPassCache,
  createRelayTokenSource,
  DEFAULT_RELAY_ACCESS_MODE,
  parseRelayAccessMode,
  parseRelayPass,
  RELAY_ACCESS_MODES,
  RELAY_PASS_INTEGRITY_BACKOFF_MS,
  RELAY_PASS_REFUSED_BACKOFF_MS,
  RELAY_PASS_RENEW_MARGIN_MS,
  RELAY_PASS_STEP_TIMEOUT_MS,
  RelayPassTimeoutError,
  RelayPassUnavailableError,
  RELAY_PASS_VERSION,
  RelayAccessError,
} from './relay-pass.ts';

export type { LoopbackNetwork, LoopbackFaults } from './loopback.ts';
export { createLoopbackNetwork } from './loopback.ts';

export {
  encodeHandshake,
  MAX_BATCH_BYTES,
  openMessages,
  readHandshake,
  sealMessages,
  SESSION_MAGIC,
  wireRowBytes,
} from './wire.ts';

// A holder's erasure receipt, checked on the phone (ADR-17 §10, 2026-09-27).
export type { HolderPins, HolderReceipt, ReceiptCheck, SignedHolderReceipt } from './holder.ts';
export {
  capabilityCommitment,
  erasureCapability,
  requestDigest,
  signedHolderReceiptSchema,
  verifyHolderReceipt,
} from './holder.ts';
