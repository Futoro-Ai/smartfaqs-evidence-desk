import type { EvidenceChunk, KnowledgeSource } from "@/lib/evidence/types";

export const knowledgeSources: KnowledgeSource[] = [
  {
    ref: "source:employee-handbook",
    label: "Northstar Employee Handbook",
    summary: "Leave, scheduling, conduct, and workplace policy.",
    owner: "People Operations",
    version: "2026.2",
    updatedAt: "August 18, 2026",
    accent: "green",
    chunkCount: 4,
  },
  {
    ref: "source:benefits-guide",
    label: "Northstar Benefits Guide",
    summary: "Health, retirement, and wellness program overview.",
    owner: "Total Rewards",
    version: "2026.1",
    updatedAt: "July 9, 2026",
    accent: "coral",
    chunkCount: 3,
  },
  {
    ref: "source:remote-work-standard",
    label: "Distributed Work Standard",
    summary: "Eligibility, security, equipment, and travel guidance.",
    owner: "Workplace Systems",
    version: "2026.3",
    updatedAt: "August 25, 2026",
    accent: "gold",
    chunkCount: 3,
  },
];

export const evidenceChunks: EvidenceChunk[] = [
  {
    ref: "chunk:leave-accrual-table",
    sourceRef: "source:employee-handbook",
    label: "Annual leave schedule",
    section: "4.2 Annual Leave",
    page: 18,
    kind: "table",
    content:
      "Full-time annual leave allowance by completed years of service. One day is eight working hours.",
    table: {
      headers: ["Completed service", "Annual hours", "Equivalent days"],
      rows: [
        ["0-4 years", "80 hours", "10 days"],
        ["5-9 years", "104 hours", "13 days"],
        ["10+ years", "128 hours", "16 days"],
      ],
    },
    keywords: ["annual", "leave", "vacation", "service", "104", "13", "days"],
  },
  {
    ref: "chunk:leave-accrual-method",
    sourceRef: "source:employee-handbook",
    label: "How leave is recorded",
    section: "4.2 Annual Leave",
    page: 19,
    kind: "text",
    content:
      "Annual leave is credited in equal increments each biweekly pay period. Employees can review accrued and scheduled balances in the People Portal.",
    keywords: ["leave", "credited", "accrued", "pay", "period", "balance", "portal"],
  },
  {
    ref: "chunk:leave-eligibility",
    sourceRef: "source:employee-handbook",
    label: "Eligibility and proration",
    section: "4.1 Time Away",
    page: 17,
    kind: "text",
    content:
      "Regular full-time employees participate in the annual leave program. Part-time allowances are prorated according to scheduled hours.",
    keywords: ["full-time", "part-time", "eligible", "prorated", "annual", "leave"],
  },
  {
    ref: "chunk:holiday-schedule",
    sourceRef: "source:employee-handbook",
    label: "Observed holidays",
    section: "4.4 Holidays",
    page: 22,
    kind: "text",
    content:
      "Northstar publishes the observed holiday calendar each November for the following year. Holiday time is separate from annual leave.",
    keywords: ["holiday", "calendar", "annual", "leave", "separate"],
  },
  {
    ref: "chunk:medical-plan",
    sourceRef: "source:benefits-guide",
    label: "Medical plan choices",
    section: "2.1 Health Coverage",
    page: 6,
    kind: "text",
    content:
      "Employees may choose between two synthetic medical plans during annual enrollment. Coverage begins on the first day of the month after eligibility.",
    keywords: ["medical", "health", "coverage", "enrollment", "eligibility"],
  },
  {
    ref: "chunk:retirement-match",
    sourceRef: "source:benefits-guide",
    label: "Retirement contribution",
    section: "3.3 Retirement",
    page: 12,
    kind: "text",
    content:
      "Northstar contributes a fictional dollar-for-dollar match on the first four percent of eligible compensation after 90 days of service.",
    keywords: ["retirement", "match", "four", "percent", "90", "days"],
  },
  {
    ref: "chunk:wellness-credit",
    sourceRef: "source:benefits-guide",
    label: "Wellness learning credit",
    section: "5.1 Wellness",
    page: 20,
    kind: "text",
    content:
      "A fictional annual learning and wellness credit of $400 is available for approved activities and courses.",
    keywords: ["wellness", "learning", "credit", "400", "courses"],
  },
  {
    ref: "chunk:remote-eligibility",
    sourceRef: "source:remote-work-standard",
    label: "Remote-work eligibility",
    section: "1.2 Eligibility",
    page: 3,
    kind: "text",
    content:
      "Roles are evaluated for distributed work according to collaboration, customer, data-handling, and equipment requirements.",
    keywords: ["remote", "distributed", "eligibility", "customer", "equipment"],
  },
  {
    ref: "chunk:remote-security",
    sourceRef: "source:remote-work-standard",
    label: "Workspace security",
    section: "3.1 Information Security",
    page: 9,
    kind: "text",
    content:
      "Confidential information must be accessed on managed devices through approved encrypted connections. Shared public computers are prohibited.",
    keywords: ["security", "managed", "device", "encrypted", "confidential"],
  },
  {
    ref: "chunk:remote-equipment",
    sourceRef: "source:remote-work-standard",
    label: "Standard equipment",
    section: "4.2 Equipment",
    page: 13,
    kind: "table",
    content: "Standard equipment by distributed-work classification.",
    table: {
      headers: ["Classification", "Provided equipment"],
      rows: [
        ["Hybrid", "Laptop, dock, headset"],
        ["Remote", "Laptop, dock, monitor, headset"],
      ],
    },
    keywords: ["remote", "hybrid", "equipment", "laptop", "monitor", "headset"],
  },
];
