/**
 * A bridge on the estate's network: its directory record, deposits into patients' mailboxes, and
 * collection from its own.
 * @module
 */

import { bytesToHex, hexToBytes } from '@cosys/crypto';
import { fromBase64, toBase64 } from '@cosys/crypto/base64';
import {
  addressOf,
  createCouchMailbox,
  createDirectoryClient,
  createProvisioningClient,
  type DeviceIdentity,
  type Mailbox,
  type MailboxAddress,
} from '@cosys/peer';

/**
 * A bridge on the estate's network (ADR-22 §1, §4): the same provisioning service, directory and
 * CouchDB mailbox a phone uses, reached the same way, with nothing in the estate changed for it
 * but the one-time intake (`server/provision.mjs`).
 *
 * - **Its record** is signed by the bridge key and says who may deposit to it: every patient
 *   paired with it, and, through the intake group, whoever presents a code it offered.
 * - **It deposits** into a patient's mailbox as any depositor does, sealed to the patient's
 *   certified mailbox key from the patient's own signed record.
 * - **It collects** its intake group and one mailbox per paired patient, purging what it read.
 */
export interface BridgeNetwork {
  /**
   * Publishes the bridge's signed directory record: `patients` may deposit to it, and each offer
   * not yet expired (`expiresAt` in milliseconds since the epoch) opens the intake group to its
   * code.
   */
  publish(
    patients: readonly string[],
    offers: readonly { readonly digest: string; readonly expiresAt: number }[],
  ): Promise<void>;
  /** The patient's mailbox address, from their directory record. */
  addressOf(patient: string): Promise<MailboxAddress>;
  /** The patient's mailbox, as this bridge deposits to it. */
  depositTo(patient: string): Mailbox;
  /** The intake group first, then each paired patient's mailbox. */
  inbound(patients: readonly string[]): readonly Mailbox[];
}

/** The group a code's deposit lands in: the one group a bridge's record names. */
export const INTAKE_GROUP = '1';

/** Where the estate's services are, and the identity the bridge reaches them with. */
export interface BridgeNetworkOptions {
  /** The bridge's identity: it signs the bridge's record and its requests for tokens. */
  readonly identity: DeviceIdentity;
  /** The provisioning service and directory. */
  readonly serviceUrl: string;
  /** The CouchDB the mailboxes are on. */
  readonly mailboxUrl: string;
  /** The `fetch` to use; the global one when absent. */
  readonly fetch?: typeof globalThis.fetch;
  /** The clock, in milliseconds since the epoch; `Date.now` when absent. */
  readonly now?: () => number;
}

/** Creates a bridge's network over the two URLs; a trailing slash on either is ignored. */
export function createBridgeNetwork(options: BridgeNetworkOptions): BridgeNetwork {
  const serviceUrl = options.serviceUrl.replace(/\/+$/, '');
  const mailboxUrl = options.mailboxUrl.replace(/\/+$/, '');
  const now = options.now ?? Date.now;
  const fetchOption = options.fetch === undefined ? {} : { fetch: options.fetch };
  const provisioning = createProvisioningClient({ server: serviceUrl, ...fetchOption });
  const directory = createDirectoryClient({ server: serviceUrl, ...fetchOption });
  const { identity } = options;
  const intake = { kind: 'group' as const, groupId: INTAKE_GROUP };

  const collect = (scope: Parameters<typeof createCouchMailbox>[0]['scope']) =>
    createCouchMailbox({
      server: mailboxUrl,
      recipientKey: identity.publicKey,
      scope,
      ...fetchOption,
      token: provisioning.tokenSource(identity, {
        role: 'collect',
        recipient: identity.publicKey,
        scope,
      }),
      purge: (receipts) => provisioning.purge(identity, receipts, scope),
    });

  return {
    async publish(patients, offers) {
      const address = addressOf(identity);
      await directory.publish(identity, {
        mailboxKey: toBase64(address.mailboxKey),
        mailboxCertificate: toBase64(address.certificate),
        endpoint: null,
        deposits: [...patients],
        groups: { [INTAKE_GROUP]: [] },
        intake: {
          group: INTAKE_GROUP,
          offers: offers
            .filter((offer) => offer.expiresAt > now())
            .map((offer) => ({
              digest: offer.digest,
              until: new Date(offer.expiresAt).toISOString(),
            })),
        },
        updatedAt: new Date(now()).toISOString(),
      });
    },

    async addressOf(patient) {
      const key = hexToBytes(patient);
      const record = await directory.lookup(key);
      return {
        identityKey: key,
        mailboxKey: fromBase64(record.mailboxKey),
        certificate: fromBase64(record.mailboxCertificate),
      };
    },

    depositTo(patient) {
      const recipient = hexToBytes(patient);
      const scope = { kind: 'peer' as const, peerKey: identity.publicKey };
      return createCouchMailbox({
        server: mailboxUrl,
        recipientKey: recipient,
        scope,
        fromKey: identity.publicKey,
        ...fetchOption,
        token: provisioning.tokenSource(identity, { role: 'deposit', recipient, scope }),
      });
    },

    inbound(patients) {
      return [
        collect(intake),
        ...patients.map((patient) => collect({ kind: 'peer', peerKey: hexToBytes(patient) })),
      ];
    },
  };
}

/** The bridge's key as hex, the way its directory entry and its rows name it. */
export const bridgeKeyOf = (identity: DeviceIdentity): string => bytesToHex(identity.publicKey);
