// One invented source note, four independently prepared transformations.
// Never feed a result into another option. Every `before` shares this exact source.
// Stable block ids let the preview animate edits, insertions and movement in place.
import { SAGE_GOALS } from '../room/sageChoices';

export const SAGE_PLANS = {
  patch: 'Quick edit — only the blocks that need it change.',
  reflow: 'Edit and add — new blocks land right where they belong.',
  layout: 'Rebuild — the whole thing, reorganised.',
};

const NEXT = {
  id: 'next', type: 'check', items: [
    { text: 'Send Mira the site contact list', done: true },
    { text: 'Check Tuesday with Omar', done: false },
    { text: 'Book the forklift for the first delivery', done: false },
  ],
};

export const SAGE_NOTE = {
  group: 'Working Notes',
  title: 'Call with Mira — north site',
  tags: ['field-team'],
  before: [
    { id: 'receiving', type: 'p', text: 'mira says the north site can take deliverys tuesday and thursday mornings, not before 8' },
    { id: 'forklift', type: 'p', text: 'forklift is shared with the other tennant so it has to be booked a day ahead, cant just turn up and use it' },
    { id: 'door', type: 'p', text: 'loading door is 2.4m high. anything taller goes thru the yard gate' },
    { id: 'critical', type: 'p', text: 'omar called forklift booking a critical path task — if it slips the first delivery slips too. zero float in that part of the plan he says' },
    { id: 'timing', type: 'p', text: 'carrier eta still missing. tuesday is pencilled in not confrimed so dont put an arrival time in the timeline yet' },
    { id: 'deadline', type: 'p', text: 'she needs the revised timline by friday , i said yes but check with omar first' },
    NEXT,
  ],
};

const EXAMPLES = [
  {
    goal: 'polish', plan: 'patch', about: 'Fix the writing without changing the plan',
    after: [
      { id: 'receiving', type: 'p', change: 'edited', text: 'Mira says the north site can take deliveries Tuesday and Thursday mornings, not before 8.' },
      { id: 'forklift', type: 'p', change: 'edited', text: 'The forklift is shared with the other tenant, so it has to be booked a day ahead. You can’t just turn up and use it.' },
      { id: 'door', type: 'p', change: 'edited', text: 'The loading door is 2.4 m high. Anything taller goes through the yard gate.' },
      { id: 'critical', type: 'p', change: 'edited', text: 'Omar called forklift booking a critical-path task — if it slips, the first delivery slips too. There is zero float in that part of the plan, he says.' },
      { id: 'timing', type: 'p', change: 'edited', text: 'The carrier ETA is still missing. Tuesday is pencilled in, not confirmed, so don’t put an arrival time in the timeline yet.' },
      { id: 'deadline', type: 'p', change: 'edited', text: 'She needs the revised timeline by Friday. I said yes, but check with Omar first.' },
      NEXT,
    ],
    note: 'Corrected spelling, capitals and punctuation. The dates, measurements, uncertainty and checklist are unchanged.',
    suggested: ['deliveries', 'north-site'],
  },
  {
    goal: 'simplify', plan: 'patch', about: 'Untangle the same call note',
    after: [
      { id: 'receiving', type: 'p', change: 'edited', text: 'Mira says the north site accepts deliveries on Tuesday and Thursday mornings, from 8 onwards.' },
      { id: 'forklift', type: 'p', change: 'edited', text: 'Book the shared forklift a day ahead. The other tenant uses it too, so it won’t be available without a booking.' },
      { id: 'door', type: 'p', change: 'edited', text: 'The loading door is 2.4 m high. Use the yard gate for anything taller.' },
      { id: 'critical', type: 'p', change: 'edited', text: 'Omar says the first delivery depends on the forklift booking. A late booking means a late delivery. There is no spare time in this part of the plan.' },
      { id: 'timing', type: 'p', change: 'edited', text: 'Tuesday is tentative. We are still waiting for the carrier’s estimated arrival time, so leave that time out of the timeline for now.' },
      { id: 'deadline', type: 'p', change: 'edited', text: 'Mira needs the revised timeline by Friday. I agreed, but need to check with Omar first.' },
      NEXT,
    ],
    note: 'Said “critical path”, “float” and “ETA” plainly. Tuesday is still tentative; the arrival time is still unknown.',
    suggested: ['delivery-plan', 'north-site'],
  },
  {
    goal: 'examples', plan: 'reflow', about: 'Leave the words; fill in the skipped steps',
    after: [
      SAGE_NOTE.before[0],
      { id: 'window-explained', type: 'p', change: 'added', text: 'The receiving window tells us when the site can accept a delivery. It does not confirm when the carrier will arrive.' },
      ...SAGE_NOTE.before.slice(1, 4),
      { id: 'why-path', type: 'callout', tone: 'green', label: 'Why it matters', change: 'added', text: '**Critical path** means this step can hold up what follows. Here, unloading depends on a booked forklift. If the forklift isn’t booked, the first delivery has to wait. **Zero float** means there is no spare time to absorb that delay.' },
      SAGE_NOTE.before[4],
      { id: 'eta-explained', type: 'p', change: 'added', text: '**ETA** is the estimated time of arrival. The carrier hasn’t supplied one, so “Tuesday” is a tentative day, not a confirmed arrival slot. The site’s opening hours don’t tell us when the carrier will arrive.' },
      SAGE_NOTE.before[5],
      NEXT,
    ],
    note: 'Clarified the receiving window, linked the booking to the delivery, and explained float and ETA. Your original lines stay exactly as written.',
    suggested: ['dependencies', 'delivery-plan'],
  },
  {
    goal: 'restructure', plan: 'layout', about: 'Turn the same fragments into a reference page',
    after: [
      { id: 'access-heading', type: 'h', text: 'Receiving and access' },
      { id: 'receiving', type: 'p', text: 'Mira says the north site accepts deliveries **Tuesday and Thursday mornings, from 8 onwards**.' },
      { id: 'door', type: 'p', text: 'The loading door is **2.4 m high**. Anything taller goes through the yard gate.' },
      { id: 'forklift', type: 'p', text: 'The forklift is shared with the other tenant. **Book it a day ahead**; it cannot be used without a booking.' },
      { id: 'dependency-heading', type: 'h', text: 'The dependency to remember' },
      { id: 'critical', type: 'pair', left: { title: 'Critical path', items: ['Omar says the first delivery depends on forklift booking.', 'If booking slips, the first delivery slips too.'] }, right: { title: 'Zero float', items: ['No spare time in this part of the plan.', 'A booking delay cannot be absorbed here.'] } },
      { id: 'timing-heading', type: 'h', text: 'Timing and next steps' },
      { id: 'timing', type: 'callout', tone: 'rose', label: 'Still tentative', text: 'Tuesday is pencilled in. The carrier’s estimated arrival time is missing, so leave an arrival time out of the timeline for now.' },
      { id: 'deadline', type: 'p', text: 'Mira needs the revised timeline **by Friday**. I agreed, but need to check with Omar first.' },
      NEXT,
    ],
    note: 'Grouped access details, put the two scheduling terms side by side, and made the unconfirmed timing easy to spot. Kept every fact and checklist state.',
    suggested: ['site-brief', 'dependencies'],
  },
];

export const SAGE_EXAMPLES = EXAMPLES.map((example) => {
  const goal = SAGE_GOALS.find((item) => item.id === example.goal);
  return { ...SAGE_NOTE, ...example, id: example.goal, label: goal?.label ?? example.goal, hint: goal?.hint ?? '' };
});
