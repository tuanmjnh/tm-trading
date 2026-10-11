// =============================================================================
//  TM TRADING — realtime plane (roadmap V3 §31), pure core.
//
//  Barrels the transport-agnostic pieces: envelope + sequencer (§31.2),
//  subscribe protocol (§31.1) and the client recovery state machine (§31.3).
//  A later slice wires these to an actual WebSocket transport; nothing here
//  opens a socket or touches the clock.
// =============================================================================

export {
  ENVELOPE_FIELDS,
  channelKeyOf,
  isKnownTopic,
  createSequencer,
  envelopeFor,
  seal
} from './envelope.mjs'

export {
  TOPIC_ALIASES,
  SubscriptionError,
  canonicalTopic,
  identityResolver,
  normalizeChannel,
  parseSubscribe,
  matchChannels
} from './subscriptions.mjs'

export {
  RECOVERY_STATES,
  createRecovery
} from './recovery.mjs'
