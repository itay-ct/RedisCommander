import type { CategoryMeta } from '../types'

const fallbackTagline =
  'Operational Redis commands, presented in a keyboard-first terminal atlas.'

export const PRIMARY_GROUPS = [
  'string',
  'hash',
  'list',
  'set',
  'sorted-set',
  'stream',
  'json',
  'search',
  'generic',
  'pubsub',
]

export const CATEGORY_META: Record<string, CategoryMeta> = {
  bf: {
    accent: '#ffb553',
    artLabel: 'Bloom',
    label: 'Bloom',
    tagline: 'Probabilistic membership checks for ultra-compact existence tests.',
  },
  bitmap: {
    accent: '#0fa869',
    artLabel: 'Bitmaps',
    label: 'Bitmaps',
    tagline: 'Bit-level state, flags, counters, and dense binary occupancy maps.',
  },
  cf: {
    accent: '#ffb553',
    artLabel: 'Cuckoo',
    label: 'Cuckoo',
    tagline: 'Deletion-friendly probabilistic filters built for dynamic sets.',
  },
  cluster: {
    accent: '#5961ff',
    artLabel: 'Cluster',
    label: 'Cluster',
    tagline: 'Slots, shard topology, failover, and cluster-wide routing control.',
  },
  cms: {
    accent: '#ffb553',
    artLabel: 'Count-Min',
    label: 'Count-Min Sketch',
    tagline: 'Approximate frequencies and heavy-hitter tracking at streaming scale.',
  },
  connection: {
    accent: '#ff4438',
    artLabel: 'Connection',
    label: 'Connection',
    tagline: 'Client identity, blocking, tracking, and connection lifecycle controls.',
  },
  generic: {
    accent: '#ff4438',
    artLabel: 'Generic',
    label: 'Generic',
    tagline: 'Key lifecycle, expiration, scanning, copying, and housekeeping flows.',
  },
  geo: {
    accent: '#0fa869',
    artLabel: 'Geo',
    label: 'Geo',
    tagline: 'Coordinate storage, distance queries, and radius-based retrieval.',
  },
  hash: {
    accent: '#ff5d15',
    artLabel: 'Hashes',
    label: 'Hashes',
    tagline: 'Compact field-based records for profiles, sessions, carts, and metadata.',
  },
  hyperloglog: {
    accent: '#0fa869',
    artLabel: 'HyperLogLog',
    label: 'HyperLogLog',
    tagline: 'Approximate cardinality estimation with tiny memory footprints.',
  },
  json: {
    accent: '#5961ff',
    artLabel: 'JSON',
    label: 'JSON',
    tagline: 'Path-based document reads, mutations, and rich Redis Stack workflows.',
  },
  list: {
    accent: '#ff4438',
    artLabel: 'Lists',
    label: 'Lists',
    tagline: 'Queues, logs, work pipelines, and head-tail ordered operations.',
  },
  pubsub: {
    accent: '#dcff1e',
    artLabel: 'Pub/Sub',
    label: 'Pub/Sub',
    tagline: 'Real-time fan-out messaging, channel subscriptions, and live notifications.',
  },
  scripting: {
    accent: '#ffb553',
    artLabel: 'Scripting',
    label: 'Scripting',
    tagline: 'Lua scripts and server-side functions for atomic custom logic.',
  },
  search: {
    accent: '#5961ff',
    artLabel: 'Search',
    label: 'Search',
    tagline: 'Full-text indexes, aggregations, spellcheck, and suggestion dictionaries.',
  },
  server: {
    accent: '#ff4438',
    artLabel: 'Server',
    label: 'Server',
    tagline: 'Persistence, memory, latency, replication, and runtime diagnostics.',
  },
  set: {
    accent: '#0fa869',
    artLabel: 'Sets',
    label: 'Sets',
    tagline: 'Uniqueness, membership, relation math, and unordered group operations.',
  },
  sorted_set: {
    accent: '#ffb553',
    artLabel: 'Sorted Sets',
    label: 'Sorted Sets',
    tagline: 'Rankings, leaderboards, sliding windows, and score-based indexing.',
  },
  'sorted-set': {
    accent: '#ffb553',
    artLabel: 'Sorted Sets',
    label: 'Sorted Sets',
    tagline: 'Rankings, leaderboards, sliding windows, and score-based indexing.',
  },
  stream: {
    accent: '#dcff1e',
    artLabel: 'Streams',
    label: 'Streams',
    tagline: 'Durable event logs, consumer groups, and ordered message processing.',
  },
  string: {
    accent: '#ff4438',
    artLabel: 'Strings',
    label: 'Strings',
    tagline: 'Core reads, writes, counters, cache values, and expiration-heavy patterns.',
  },
  suggestion: {
    accent: '#5961ff',
    artLabel: 'Suggest',
    label: 'Suggestions',
    tagline: 'Autocomplete dictionaries and ranked term suggestion workflows.',
  },
  tdigest: {
    accent: '#ffb553',
    artLabel: 'T-Digest',
    label: 'T-Digest',
    tagline: 'Approximate percentiles, rank queries, and quantile-heavy analytics.',
  },
  timeseries: {
    accent: '#5961ff',
    artLabel: 'Time Series',
    label: 'Time Series',
    tagline: 'Append-only metrics, rollups, downsampling, and range analytics.',
  },
  topk: {
    accent: '#ffb553',
    artLabel: 'Top-K',
    label: 'Top-K',
    tagline: 'Track the most frequent items without keeping the whole stream in memory.',
  },
  transactions: {
    accent: '#ff4438',
    artLabel: 'Transactions',
    label: 'Transactions',
    tagline: 'MULTI/EXEC flows, optimistic locking, and atomic orchestration.',
  },
  vector_set: {
    accent: '#5961ff',
    artLabel: 'Vector Sets',
    label: 'Vector Sets',
    tagline: 'Embeddings, similarity search, and AI-native retrieval primitives.',
  },
}

export function titleCaseGroup(group: string) {
  return group
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function getCategoryMeta(group: string): CategoryMeta {
  return (
    CATEGORY_META[group] ?? {
      accent: '#ff4438',
      artLabel: titleCaseGroup(group),
      label: titleCaseGroup(group),
      tagline: fallbackTagline,
    }
  )
}
