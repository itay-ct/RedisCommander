const art = {
  archive: String.raw`
     .--------------------.
    /  CORE + EXTENDED    /|
   /  REDIS CATALOG      / |
  .--------------------.  |
  |  STR  HASH  LIST   |  |
  |  SET  ZSET  XADD   |  |
  |  JSON  FT   TS     |  |
  |  ...               |  /
  '--------------------' /
   \____________________\/
`,
  bf: String.raw`
      .-========-.
    .'  ? ? ? ?   '.
   /  ? ? ? ? ? ?   \
  |  ? ? ? ? ? ? ?   |
  |  ? ? ? ? ? ? ?   |
   \   ? ? ? ? ?    /
    '.    Bloom   .'
      '-._____.-'
`,
  bitmap: String.raw`
   1 0 1 1 0 0 1 0
  .---------------.
  | 1 | 0 | 1 | 1 |
  | 0 | 0 | 1 | 0 |
  | 1 | 1 | 0 | 1 |
  '---------------'
      bit by bit
`,
  cf: String.raw`
     .-=======-.
   .'  /\/\/\   '.
  /   /\/\/\/\    \
 |   /\/\/\/\/\    |
 |   \/\/\/\/\/    |
  \    delete?    /
   '.   cuckoo  .'
     '-._____.-'
`,
  cluster: String.raw`
       (A)----(B)
      /  \    /  \
    (C)  (D)(E)  (F)
      \    \ |   /
       '----(G)--'
        slot mesh
`,
  cms: String.raw`
   .----------------.
   |  41  03  18  1 |
   |  12  99  22  0 |
   |   7  04  03  5 |
   '----------------'
      frequency haze
`,
  connection: String.raw`
   client -----> redis
      |            |
      | tracking   |
      '----pause---'
         unblock
`,
  generic: String.raw`
   .-------------------.
   | KEYS   TTL  SCAN  |
   | DEL   EXPIRE MOVE |
   | COPY  TYPE UNLINK |
   '-------------------'
        keyspace ops
`,
  geo: String.raw`
          N
          ^
      W <-+-> E
          v
          S
     .-.-.-.-.-.
      lat / lon
`,
  hash: String.raw`
   .-----------------.
   | field   | value |
   | user    | 42    |
   | plan    | pro   |
   | region  | eu    |
   '-----------------'
`,
  hyperloglog: String.raw`
      .-~~~~~~~-.
    .'  approx    '.
   / cardinality    \
  |  12.4M uniques   |
   \   in a sip     /
    '.___HLL_____.'
`,
  json: String.raw`
    {
      "user": {
        "id": 42,
        "tier": "pro"
      }
    }
`,
  list: String.raw`
   head -> [A]-[B]-[C]-[D] <- tail
             |   |   |   |
           queue work log jobs
`,
  pubsub: String.raw`
      broadcast
         |
   .-----+-----.
  (cli) (api) (ws)
     \    |    /
      '-- redis'
`,
  scripting: String.raw`
   EVAL -> [ Lua ]
            |  |
         keys  argv
            '-- atom'
`,
  search: String.raw`
      _________
     /  INDEX /|
    /_______ / |
    | term | | |
    | tag  | | /
    | geo  | |/
    '------'
`,
  server: String.raw`
   .----------------.
   | AOF   RDB INFO |
   | MEM  LATENCY   |
   | ROLE REPLICA   |
   '----------------'
      runtime core
`,
  set: String.raw`
      .-----.   .-----.
     /  A  / \ /  B  /
    /_____/___X_____/
    \     \   /     \
     \_____\ /_______\
        membership
`,
  'sorted-set': String.raw`
   score   member
   999  | champion
   880  | runnerup
   720  | contender
   -----+----------
     rank ladder
`,
  stream: String.raw`
  174245-0 > event-a
  174246-0 > event-b
  174247-0 > event-c
      | consumer groups |
`,
  string: String.raw`
   .-----------------.
   | GET  key        |
   | SET  value      |
   | INCR counter    |
   | EXPIRE session  |
   '-----------------'
`,
  suggestion: String.raw`
    r
    re
    red
    redi
    redis
   autocomplete
`,
  tdigest: String.raw`
     percentile curve
     .-'''''''-.
   .'  p50 p95  '.
  /   p99 p999   \
  '._ quantiles_.'
`,
  timeseries: String.raw`
   10 |          /\_
    8 |   /\    /   \
    6 |__/  \__/     \__
    4 +-----------------
        t1 t2 t3 t4 t5
`,
  topk: String.raw`
    #1  redis
    #2  cache
    #3  queue
    #4  stream
      rising fast
`,
  transactions: String.raw`
   MULTI
    |  |
   cmd cmd
    |  |
   EXEC or DISCARD
`,
  vector_set: String.raw`
   [0.18, -0.42, 0.91]
   [0.13, -0.40, 0.88]
          ||
      nearest > hit
`,
} as const

export function getAsciiArt(group: string) {
  return art[group as keyof typeof art] ?? art.archive
}
