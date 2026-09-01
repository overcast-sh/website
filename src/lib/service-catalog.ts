/**
 * service-catalog — each emulated service's visual identity on the website.
 *
 * Upstream source of truth: the web console's registry, `web/src/lib/service-registry.ts`
 * in overcast-sh/overcast. Every icon and ramp slot below is copied from that file
 * so a service looks the same in the console and on the site — "S3 is the orange
 * archive one" has to hold in both places.
 *
 * Why a static table rather than reading the registry at build time: the registry
 * names its icons as `lucide-react` *components*, and Astro needs the matching
 * `@lucide/astro` component imported statically to render it. Parsing the registry
 * would still need a name -> component table, so the parse would buy nothing and
 * cost a build that breaks whenever upstream's formatting moves. This table is the
 * same information with none of that risk.
 *
 * Keeping it in sync: when the console adds a service, add it here. Anything
 * missing falls back to a neutral cloud glyph, so the site never breaks — it just
 * looks generic until someone copies the row across.
 *
 * The `slot` is the ramp slot from the registry (`text-cat-N` -> `N`), resolved
 * through --oc-cat-N in brand-tokens.css, which mirrors the console's --cat-N.
 */

import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  Blocks,
  Boxes,
  Braces,
  Building2,
  Cable,
  CalendarClock,
  Cloud,
  Cpu,
  Database,
  DatabaseZap,
  FileClock,
  FileSearch,
  FingerprintPattern,
  Flame,
  Gauge,
  Globe,
  HardDrive,
  Key,
  KeyRound,
  Layers,
  Mail,
  MessagesSquare,
  Network,
  PlugZap,
  Radio,
  Repeat,
  Route,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Split,
  Telescope,
  ToggleRight,
  UserCheck,
  Users,
  WavesHorizontal,
  Waypoints,
  Workflow,
  Zap,
} from "@lucide/astro";

/** An icon component as `@lucide/astro` exports them. */
export type ServiceIcon = typeof Archive;

/** A ramp slot (1-10), or `muted` for the near-neutral entries the registry
 * deliberately leaves off the ramp (STS was slate — not an identity colour). */
type Slot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | "muted";

interface CatalogEntry {
  icon: ServiceIcon;
  slot: Slot;
}

/**
 * Keys are the service ids the site's own support data uses
 * (src/generated/service-support.json), which mostly match the registry's keys.
 * Where they differ the registry key is noted in a comment.
 */
const CATALOG = {
  // ── From the console registry ────────────────────────────────────────────
  s3: { icon: Archive, slot: 2 },
  efs: { icon: HardDrive, slot: 5 },
  dynamodb: { icon: Database, slot: 7 },
  rds: { icon: DatabaseZap, slot: 8 },
  elasticache: { icon: DatabaseZap, slot: 4 },
  msk: { icon: Radio, slot: 7 },
  lambda: { icon: Zap, slot: 9 },
  ec2: { icon: Cpu, slot: 6 },
  ecs: { icon: Boxes, slot: 5 },
  ecr: { icon: Boxes, slot: 1 },
  eks: { icon: Boxes, slot: 4 },
  autoscaling: { icon: Gauge, slot: 6 },
  stepfunctions: { icon: Workflow, slot: 5 },
  sqs: { icon: MessagesSquare, slot: 3 },
  sns: { icon: Bell, slot: 10 },
  ses: { icon: Mail, slot: 2 },
  pipes: { icon: Cable, slot: 6 },
  kinesis: { icon: WavesHorizontal, slot: 6 },
  eventbridge: { icon: Waypoints, slot: 1 },
  secretsmanager: { icon: KeyRound, slot: 1 },
  iam: { icon: Users, slot: 3 },
  cognito: { icon: UserCheck, slot: 8 },
  kms: { icon: Key, slot: 3 },
  ssm: { icon: SlidersHorizontal, slot: 2 },
  sts: { icon: FingerprintPattern, slot: "muted" },
  waf: { icon: ShieldAlert, slot: 1 },
  shield: { icon: ShieldCheck, slot: 8 },
  apigateway: { icon: PlugZap, slot: 4 },
  cloudfront: { icon: Globe, slot: 9 },
  appsync: { icon: Braces, slot: 10 },
  cloudformation: { icon: Layers, slot: 6 },
  appregistry: { icon: Boxes, slot: 6 },
  cloudwatch: { icon: Activity, slot: 4 },
  "cloudwatch-logs": { icon: ScrollText, slot: 5 }, // registry key: `logs`
  vpc: { icon: Network, slot: 5 },

  // ── Site-only ───────────────────────────────────────────────────────────
  // Services the support matrix lists that the console registry has no entry
  // for yet. Slots picked by the registry's own rule — the ramp hue nearest the
  // colour the service reads as — so these fold in cleanly when upstream adds them.
  route53: { icon: Route, slot: 7 },
  scheduler: { icon: CalendarClock, slot: 3 },
  athena: { icon: FileSearch, slot: 5 },
  bedrock: { icon: Sparkles, slot: 8 },
  glue: { icon: Blocks, slot: 2 },
  opensearch: { icon: Telescope, slot: 6 },
  acm: { icon: BadgeCheck, slot: 4 },
  backup: { icon: ArchiveRestore, slot: 5 },
  cloudtrail: { icon: FileClock, slot: 3 },
  organizations: { icon: Building2, slot: 7 },
  transfer: { icon: ArrowLeftRight, slot: 6 },
  firehose: { icon: Flame, slot: 1 },
  appconfig: { icon: ToggleRight, slot: 4 },
  appconfigdata: { icon: ToggleRight, slot: 4 },
  dynamodbstreams: { icon: Repeat, slot: 7 },
  elbv2: { icon: Split, slot: 4 },
} as const satisfies Record<string, CatalogEntry>;

const FALLBACK: CatalogEntry = { icon: Cloud, slot: "muted" };

export interface ServiceVisual {
  /** The service's glyph, ready to render as an Astro component. */
  Icon: ServiceIcon;
  /** The service's identity colour as a CSS value, for `--oc-tint`. */
  tint: string;
}

/**
 * The icon and tint for a service id. Unknown ids get the neutral cloud rather
 * than throwing — the support matrix is generated from upstream and may list a
 * service before this table learns about it.
 */
export function serviceVisual(service: string): ServiceVisual {
  const entry: CatalogEntry = CATALOG[service as keyof typeof CATALOG] ?? FALLBACK;
  return {
    Icon: entry.icon,
    tint: entry.slot === "muted" ? "var(--oc-muted)" : `var(--oc-cat-${entry.slot})`,
  };
}
