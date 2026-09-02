/* ============================================================================
   Arrival — demo sign-in layer
   ----------------------------------------------------------------------------
   Lets anyone open a workspace with fictional data and no backend. Built for
   walkthroughs and sales demos.

   It does not touch the production sign-in path. The magic-link flow, Auth,
   RLS and every Data.* read behave exactly as before when DEMO is false.

   INSTALL — five edits to index.html:

   1. Paste the module below immediately above  async function boot(){
      (currently ~line 7474).

   2. In Data.loadAll(), as the first line of the body:
          if(DEMO){ demoSeed(); return {ok:true}; }

   3. Replace Data.refresh() with:
          async refresh(){ if(DEMO){ S.monthly = Data.monthlyRollup(S.relocations); route(); return {ok:true}; }
                           const r = await Data.loadAll(); route(); return r; },

   4. In Auth.signOut(), as the first line of the body:
          if(DEMO){ demoEnd(); return; }

   5. In boot(), directly after the !PORTALS_ENABLED guard:
          if(demoRestore()){
            AUTH_STATE = 'ok';
            const app = document.getElementById('app');
            if(app && isPortalPath(curPath())) app.innerHTML = bootSplash();
            setTimeout(route, 450);
            return;
          }

   OPTIONAL — so demo actions stick for the session (mark paid moves money into
   financials, replies append to threads), change save() to:

          function save(){
            if(typeof DEMO !== 'undefined' && DEMO) return;
            throw new NotPersisted();
          }

      Outside demo mode this still throws, exactly as it does now. Without it,
      every demo write fails with the NotPersisted toast.

   UI — the sign-in panel. In renderLogin(), before the closing
   "Access is issued by your Arrival coordinator" paragraph:
           <div style="margin-top:30px;padding-top:24px;border-top:1px solid var(--line)">
          <div class="flex between" style="align-items:baseline;gap:10px;flex-wrap:wrap">
            <span class="eyebrow" style="color:var(--gold-deep)">Demo access</span>
            <span class="tiny muted">No email required</span>
          </div>
          <p class="tiny muted" style="margin-top:8px">Open a workspace with fictional data to see how each role experiences the platform. Nothing here touches a real account, and nothing you change is saved.</p>
          <div style="display:flex;flex-direction:column;gap:9px;margin-top:14px">
            ${[['owner','RA','Rowan Ashcombe','Command Center · Arrival owner'],
                ['corporate','IR','Imani Roswell','Employer portal · Verrick Capital'],
                ['internal','DW','Dana Whitfield','Command Center · Arrival coordinator'],
                ['agent','CM','Callie Mercer','Agent portal · Mercer Group']
               ].map(([k,ini,nm,sub])=>`
              <button type="button" class="card" onclick="demoSignIn('${k}')" style="display:flex;align-items:center;gap:12px;text-align:left;padding:12px 14px;cursor:pointer;width:100%;background:#fff">
                <span class="avatar sm">${ini}</span>
                <span style="flex:1;min-width:0">
                  <b style="display:block;font-size:13.5px;color:var(--navy)">${nm}</b>
                  <span class="tiny muted">${sub}</span>
                </span>
                <span style="flex:none;color:var(--gold-deep)">${ic('arrR','ic-sm')}</span>
              </button>`).join('')}
          </div>
        </div>


   BEFORE PRODUCTION: decide whether demo access belongs on the public sign-in
   page at all. To keep the capability but hide the door, gate the panel on a
   query string (?demo=1) or drop it and call demoSignIn() from the console.
   ========================================================================== */


/* =========================================================
   DEMO MODE — added for prototype walkthroughs.
   Not part of the production sign-in path. Bypasses Supabase entirely:
   sets ME by hand, fills S from the fixture below, and short-circuits
   every read so nothing touches the network. Writes are NOT stubbed, so
   any save in demo mode fails loudly rather than pretending it stored.
   ========================================================= */
let DEMO = false;
const LS_DEMO = 'arrival.demo.role';

const DEMO_USERS = {
  corporate: { id:'demo-u-corp', appRole:'company',     role:'corporate', name:'Imani Roswell',
               email:'imani.roswell@verrickcapital.com', companyId:'demo-c2', agentId:null,
               title:'Director, People Operations', org:'Verrick Capital' },
  owner:     { id:'demo-u-owner', appRole:'owner',       role:'internal',  name:'Rowan Ashcombe',
               email:'rowan@arrivalrelopartners.com', companyId:null, agentId:null,
               title:'Owner', org:'Arrival' },
  internal:  { id:'demo-u-coord', appRole:'coordinator', role:'internal',  name:'Dana Whitfield',
               email:'dana.whitfield@arrivalrelopartners.com', companyId:null, agentId:null,
               title:'Relocation Coordinator', org:'Arrival' },
  agent:     { id:'demo-u-agent', appRole:'agent',      role:'agent',     name:'Callie Mercer',
               email:'callie@mercergroup.com', companyId:null, agentId:'demo-a5',
               title:'Broker', org:'Mercer Group' },
};

function demoISO(daysAgo, hh){
  const d = new Date(Date.now() - daysAgo*864e5);
  return d.toISOString().slice(0,10) + ' ' + (hh || '09:14');
}
function demoDate(daysFromNow){
  return new Date(Date.now() + daysFromNow*864e5).toISOString().slice(0,10);
}

function demoFixture(){
  const co = [
    {id:'demo-c1', name:'Halden Biosciences', industry:'Life sciences', hq:'Boston, MA', active:true,
     stage:'Customer', tier:'Enterprise', value:184000, est:'12–18 / yr', since:'2024-03-01',
     next:'Q4 volume review', notes:'Two research sites hiring into Raleigh and Boston.', owner:'Dana Whitfield'},
    {id:'demo-c2', name:'Verrick Capital', industry:'Financial services', hq:'Charlotte, NC', active:true,
     stage:'Customer', tier:'Mid-market', value:96000, est:'8–12 / yr', since:'2024-09-15',
     next:'Renewal call scheduled', notes:'Uptown Charlotte consolidation drives most moves.', owner:'Dana Whitfield'},
    {id:'demo-c3', name:'Northbay Systems', industry:'Technology', hq:'Seattle, WA', active:true,
     stage:'Customer', tier:'Enterprise', value:142000, est:'10–15 / yr', since:'2025-01-20',
     next:'Add Austin to covered markets', notes:'Engineering relocations, mostly new hires.', owner:'Dana Whitfield'},
    {id:'demo-c4', name:'Corriden Health', industry:'Healthcare', hq:'Nashville, TN', active:true,
     stage:'In Discussion', tier:'Mid-market', value:null, est:'6–10 / yr', since:null,
     next:'Proposal sent, awaiting legal', notes:'Nursing and physician relocations.', owner:'Dana Whitfield'},
  ];

  const ag = [
    {id:'demo-a1', name:'Marguerite Iselin', email:'marguerite@iselinvance.com', phone:'(919) 555-0142',
     brokerage:'Iselin & Vance', market:'Raleigh, NC', yrs:14, done:212, rating:4.9, resp:'0.6 hr',
     langs:['English'], specs:['Relocation','New construction'], bio:'Fourteen years in the Triangle, most of it with relocating families.',
     license:'NC-284117', licenseState:'NC', licenseExpires:'2027-04-30', active:true, _rating:4.9, _yrs:14},
    {id:'demo-a2', name:'Desmond Achebe', email:'desmond@keylinepartners.com', phone:'(512) 555-0188',
     brokerage:'Keyline Partners', market:'Austin, TX', yrs:9, done:143, rating:4.8, resp:'0.8 hr',
     langs:['English'], specs:['Technology transfers','First-time buyers'], bio:'Works almost entirely with inbound technology hires.',
     license:'TX-661204', licenseState:'TX', licenseExpires:'2026-11-30', active:true, _rating:4.8, _yrs:9},
    {id:'demo-a3', name:'Priya Raghunathan', email:'priya@cardinalrow.com', phone:'(617) 555-0126',
     brokerage:'Cardinal Row', market:'Boston, MA', yrs:17, done:288, rating:4.9, resp:'1.1 hr',
     langs:['English','Tamil'], specs:['Academic relocations','Medical relocations'], bio:'Longwood and Cambridge specialist.',
     license:'MA-119043', licenseState:'MA', licenseExpires:'2027-01-31', active:true, _rating:4.9, _yrs:17},
    {id:'demo-a4', name:'Tomas Berglund', email:'tomas@harborfield.com', phone:'(206) 555-0173',
     brokerage:'Harbor & Field', market:'Seattle, WA', yrs:11, done:176, rating:4.7, resp:'0.7 hr',
     langs:['English','Swedish'], specs:['Tech leadership','Waterfront'], bio:'Eastside and in-city, senior engineering moves.',
     license:'WA-773915', licenseState:'WA', licenseExpires:'2026-08-31', active:true, _rating:4.7, _yrs:11},
    {id:'demo-a5', name:'Callie Mercer', email:'callie@mercergroup.com', phone:'(704) 555-0119',
     brokerage:'Mercer Group', market:'Charlotte, NC', yrs:8, done:121, rating:4.8, resp:'0.9 hr',
     langs:['English'], specs:['Banking transfers','Suburbs'], bio:'Uptown, Myers Park and the south suburbs.',
     license:'NC-330271', licenseState:'NC', licenseExpires:'2027-06-30', active:true, _rating:4.8, _yrs:8},
    {id:'demo-a6', name:'Elias Font', email:'elias@fontresidential.com', phone:'(615) 555-0154',
     brokerage:'Font Residential', market:'Nashville, TN', yrs:12, done:198, rating:4.6, resp:'1.3 hr',
     langs:['English','Spanish'], specs:['Healthcare relocations'], bio:'Works the Vanderbilt and HCA corridors.',
     license:'TN-448820', licenseState:'TN', licenseExpires:'2026-12-31', active:true, _rating:4.6, _yrs:12},
  ];

  const R = (o) => Object.assign({
    uuid:null, id:null, emp:null, email:null, phone:null, role:null, dept:null, origin:null, dest:null,
    type:'Transfer', mode:'Buyer', status:'Intake', risk:null, agentId:null, companyId:null, target:null,
    submitted:null, last:null, progress:0, office:null,
    budget:null, household:null, schools:null, commute:null, special:null, salary:null,
    beds:null, baths:null, pets:null, hasPrivate:true,
  }, o);

  const rel = [
    R({uuid:'demo-r1', id:'ARP-104821', emp:'Nadia Oyelaran', email:'n.oyelaran@haldenbio.com', phone:'(312) 555-0164',
       role:'Director, Clinical Operations', dept:'Clinical', origin:'Chicago, IL', dest:'Raleigh, NC',
       type:'Transfer', mode:'Buyer & Seller', status:'Under Contract', risk:'Low', agentId:'demo-a1',
       companyId:'demo-c1', target:demoDate(44), submitted:demoISO(63).slice(0,10), last:demoISO(0,'11:20'),
       progress:72, office:'Research Triangle Park',
       budget:'$780,000', household:'2 adults, 1 child', schools:'Public, K-5 priority',
       commute:'Under 30 minutes to RTP', special:'Wants to close before the school year.',
       salary:null, beds:4, baths:3, pets:'One dog'}),
    R({uuid:'demo-r2', id:'ARP-104793', emp:'Grant Beaulieu', email:'g.beaulieu@northbaysys.com', phone:'(617) 555-0192',
       role:'Staff Engineer', dept:'Platform', origin:'Boston, MA', dest:'Seattle, WA',
       type:'New Hire', mode:'Buyer', status:'Home Search', risk:'Medium', agentId:'demo-a4',
       companyId:'demo-c3', target:demoDate(61), submitted:demoISO(38).slice(0,10), last:demoISO(1,'16:02'),
       progress:48, office:'Seattle HQ',
       budget:'$1,150,000', household:'2 adults', schools:'Not required',
       commute:'Rail access preferred', special:'Second tour scheduled on the Eastside.',
       salary:null, beds:3, baths:2, pets:'None'}),
    R({uuid:'demo-r3', id:'ARP-104766', emp:'Imani Roswell', email:'i.roswell@verrickcapital.com', phone:'(212) 555-0107',
       role:'VP, Underwriting', dept:'Risk', origin:'New York, NY', dest:'Charlotte, NC',
       type:'Transfer', mode:'Buyer & Seller', status:'Closing Scheduled', risk:'Low', agentId:'demo-a5',
       companyId:'demo-c2', target:demoDate(21), submitted:demoISO(88).slice(0,10), last:demoISO(1,'09:41'),
       progress:91, office:'Uptown Charlotte',
       budget:'$940,000', household:'2 adults, 2 children', schools:'Independent, grades 4 and 7',
       commute:'Uptown, under 25 minutes', special:'Closing set, walkthrough the morning of.',
       salary:null, beds:4, baths:3, pets:'None'}),
    R({uuid:'demo-r4', id:'ARP-104802', emp:'Theo Lindqvist', email:'t.lindqvist@haldenbio.com', phone:'(858) 555-0139',
       role:'Principal Scientist', dept:'Research', origin:'San Diego, CA', dest:'Boston, MA',
       type:'New Hire', mode:'Renter', status:'Agent Assigned', risk:'Low', agentId:'demo-a3',
       companyId:'demo-c1', target:demoDate(91), submitted:demoISO(24).slice(0,10), last:demoISO(2,'14:35'),
       progress:31, office:'Boston Seaport',
       budget:'$1,020,000', household:'1 adult', schools:'Not required',
       commute:'Longwood, walkable', special:'Renting for a year before buying.',
       salary:null, beds:2, baths:1, pets:'One cat'}),
    R({uuid:'demo-r5', id:'ARP-104830', emp:'Priscilla Vance', email:'p.vance@verrickcapital.com', phone:'(404) 555-0175',
       role:'Regional Counsel', dept:'Legal', origin:'Atlanta, GA', dest:'Charlotte, NC',
       type:'Transfer', mode:'Buyer', status:'Matching', risk:'Medium', agentId:null,
       companyId:'demo-c2', target:demoDate(75), submitted:demoISO(12).slice(0,10), last:demoISO(3,'10:08'),
       progress:18, office:'Uptown Charlotte',
       budget:'$610,000', household:'2 adults, 1 child', schools:'Public, high school',
       commute:'Flexible, hybrid schedule', special:'Shortlist of three agents in preparation.',
       salary:null, beds:3, baths:2, pets:'None'}),
    R({uuid:'demo-r6', id:'ARP-104845', emp:'Owen Takahashi', email:'o.takahashi@northbaysys.com', phone:'(303) 555-0148',
       role:'Product Lead', dept:'Product', origin:'Denver, CO', dest:'Austin, TX',
       type:'New Hire', mode:'Buyer', status:'Intake', risk:null, agentId:null,
       companyId:'demo-c3', target:demoDate(131), submitted:demoISO(4).slice(0,10), last:demoISO(4,'08:52'),
       progress:6, office:'Austin',
       budget:null, household:null, schools:null, commute:null,
       special:'Intake link sent, not yet completed.', salary:null, beds:null, baths:null, pets:null}),
    R({uuid:'demo-r7', id:'ARP-104711', emp:'Bettina Hark', email:'b.hark@corriden.com', phone:'(813) 555-0121',
       role:'Head of Nursing', dept:'Clinical', origin:'Tampa, FL', dest:'Nashville, TN',
       type:'Transfer', mode:'Buyer', status:'Completed', risk:'Low', agentId:'demo-a6',
       companyId:'demo-c4', target:demoDate(-33), submitted:demoISO(146).slice(0,10), last:demoISO(35,'15:12'),
       progress:100, office:'Nashville',
       budget:'$505,000', household:'1 adult, 2 children', schools:'Public, K-8',
       commute:'Under 20 minutes to campus', special:'Closed on time, no escalations.',
       salary:null, beds:4, baths:2, pets:'One dog'}),
    R({uuid:'demo-r8', id:'ARP-104858', emp:'Marcus Fenn', email:'m.fenn@verrickcapital.com', phone:'(214) 555-0198',
       role:'Sales Director', dept:'Commercial', origin:'Dallas, TX', dest:'Charlotte, NC',
       type:'Transfer', mode:'Buyer', status:'On Hold', risk:'High', agentId:'demo-a5',
       companyId:'demo-c2', target:demoDate(153), submitted:demoISO(31).slice(0,10), last:demoISO(8,'13:26'),
       progress:22, office:'Uptown Charlotte',
       budget:'$720,000', household:'2 adults', schools:'Not required',
       commute:null, special:'Paused at the employee\u2019s request pending a start-date change.',
       salary:null, beds:3, baths:2, pets:'None'}),
  ];

  const profiles = [
    {id:'demo-u-owner', name:'Rowan Ashcombe', email:'rowan@arrivalrelopartners.com', role:'owner'},
    {id:'demo-u-coord', name:'Dana Whitfield',  email:'dana.whitfield@arrivalrelopartners.com', role:'coordinator'},
    {id:'demo-u-coord2',name:'Sofia Vergil',    email:'sofia.vergil@arrivalrelopartners.com', role:'coordinator'},
    {id:'demo-u-corp',  name:'Imani Roswell',   email:'imani.roswell@verrickcapital.com', role:'company'},
    {id:'demo-u-agent', name:'Callie Mercer',   email:'callie@mercergroup.com', role:'agent'},
  ];

  const activity = [
    {id:'demo-m1', ts:demoISO(0,'11:20'), rel:'ARP-104821', who:'demo-u-coord', kind:'milestone',
     text:'Offer accepted \u2014 seller countered once on the closing date', employerVisible:true},
    {id:'demo-m2', ts:demoISO(0,'07:45'), rel:'ARP-104821', who:'demo-u-coord', kind:'milestone',
     text:'Inspection report received', employerVisible:false},
    {id:'demo-m3', ts:demoISO(1,'16:02'), rel:'ARP-104793', who:'demo-u-coord', kind:'milestone',
     text:'Second showing tour completed \u2014 four properties on the Eastside', employerVisible:true},
    {id:'demo-m4', ts:demoISO(1,'09:41'), rel:'ARP-104766', who:'demo-u-coord', kind:'milestone',
     text:'Closing scheduled', employerVisible:true},
    {id:'demo-m5', ts:demoISO(3,'10:08'), rel:'ARP-104830', who:'demo-u-coord', kind:'milestone',
     text:'Agent shortlist prepared for coordinator review', employerVisible:true},
    {id:'demo-m6', ts:demoISO(4,'08:52'), rel:'ARP-104845', who:'demo-u-coord', kind:'milestone',
     text:'Referral received from Northbay Systems \u2014 intake link sent', employerVisible:true},
    {id:'demo-m7', ts:demoISO(8,'13:26'), rel:'ARP-104858', who:'demo-u-coord', kind:'milestone',
     text:'Relocation placed on hold at the employee\u2019s request', employerVisible:true},
  ];

  const tasks = [
    {id:'demo-t1', title:'Confirm appraisal window', detail:'Lender needs the appraisal booked this week.',
     rel:'ARP-104821', due:demoDate(2), pri:'High', owner:'demo-u-coord', done:false},
    {id:'demo-t2', title:'Send agent shortlist to Priscilla Vance', detail:'Three Charlotte agents, rationale attached.',
     rel:'ARP-104830', due:demoDate(1), pri:'High', owner:'demo-u-coord', done:false},
    {id:'demo-t3', title:'Chase intake completion', detail:'Owen Takahashi has not opened the intake link.',
     rel:'ARP-104845', due:demoDate(3), pri:'Medium', owner:'demo-u-coord2', done:false},
    {id:'demo-t4', title:'Check in on hold status', detail:'Marcus Fenn \u2014 on hold eight days, start date under review.',
     rel:'ARP-104858', due:demoDate(0), pri:'High', owner:'demo-u-coord', done:false},
    {id:'demo-t5', title:'Confirm walkthrough time', detail:'Morning of closing, per the employee.',
     rel:'ARP-104766', due:demoDate(19), pri:'Medium', owner:'demo-u-coord', done:false},
    {id:'demo-t6', title:'Close out file', detail:'Bettina Hark \u2014 final documents filed.',
     rel:'ARP-104711', due:demoDate(-30), pri:'Low', owner:'demo-u-coord2', done:true},
  ];

  const threads = [
    {id:'demo-th1', rel:'ARP-104821', subject:'Closing date and inspection items', audience:'all', unread:false, msgs:[
      {who:'Marguerite Iselin', role:'Agent', senderId:'demo-a1', ts:demoISO(1,'15:10'),
       text:'Inspection came back clean apart from a water heater near end of life. I have asked for a credit rather than a repair, which keeps the closing date intact.'},
      {who:'Dana Whitfield', role:'Arrival', senderId:'demo-u-coord', ts:demoISO(1,'15:44'),
       text:'Agreed on the credit. Nadia is travelling Thursday, so let us get the addendum out today.'},
      {who:'Marguerite Iselin', role:'Agent', senderId:'demo-a1', ts:demoISO(0,'11:18'),
       text:'Addendum signed and returned. Closing holds.'},
    ]},
    {id:'demo-th2', rel:'ARP-104793', subject:'Eastside vs in-city shortlist', audience:'all', unread:false, msgs:[
      {who:'Tomas Berglund', role:'Agent', senderId:'demo-a4', ts:demoISO(2,'10:22'),
       text:'Four properties toured. Two on the Eastside clear the rail requirement comfortably; the in-city option is smaller for the same money.'},
      {who:'Dana Whitfield', role:'Arrival', senderId:'demo-u-coord', ts:demoISO(1,'16:02'),
       text:'Grant is weighing commute against square footage. Let us hold a third tour next week before narrowing.'},
    ]},
    {id:'demo-th3', rel:'ARP-104858', subject:'Hold status', audience:'all', unread:false, msgs:[
      {who:'Callie Mercer', role:'Agent', senderId:'demo-a5', ts:demoISO(8,'13:20'),
       text:'Marcus asked to pause the search until his start date is confirmed. Nothing lost, we can restart within a day of hearing.'},
    ]},
  ];

  const candidates = {
    'ARP-104830': [
      {id:'demo-cd1', rel:'ARP-104830', agentId:'demo-a5', rank:1,
       rationale:'Charlotte banking transfers, strong on the south suburbs the family is targeting.', selected:false},
      {id:'demo-cd2', rel:'ARP-104830', agentId:'demo-a1', rank:2,
       rationale:'Covers Charlotte through a partner office; deep relocation experience.', selected:false},
      {id:'demo-cd3', rel:'ARP-104830', agentId:'demo-a6', rank:3,
       rationale:'Backup option if the family reconsiders Nashville.', selected:false},
    ],
  };

  const opportunities = [
    {id:'demo-o1', relId:'ARP-104830', agentId:'demo-a5', title:'Buyer, relocation \u2014 Charlotte, NC',
     status:'Sent', sent:demoISO(1,'09:00'), respondBy:demoDate(1), fee:'Standard referral terms',
     summary:'Transferring employee, family of three, target under $650k, hybrid schedule. Name released on acceptance.',
     respondedAt:null},
    {id:'demo-o2', relId:null, agentId:'demo-a5', title:'Renter, 12 months \u2014 Charlotte, NC',
     status:'Sent', sent:demoISO(3,'11:30'), respondBy:demoDate(2), fee:'Standard referral terms',
     summary:'Healthcare hire relocating from out of state, renting for a year before buying.',
     respondedAt:null},
    {id:'demo-o3', relId:'ARP-104766', agentId:'demo-a5', title:'Buyer & seller \u2014 Charlotte, NC',
     status:'Accepted', sent:demoISO(86,'10:00'), respondBy:demoDate(-84), fee:'Standard referral terms',
     summary:'VP relocating from New York, dual transaction.', respondedAt:demoISO(86,'12:40')},
  ];

  const coName = {'ARP-104711':'Corriden Health','ARP-104766':'Verrick Capital','ARP-104821':'Halden Biosciences','ARP-104793':'Northbay Systems'};
  const transactions = [
    {id:'demo-x1', relId:'ARP-104711', agentId:'demo-a6', agent:'Elias Font', kind:'Purchase', status:'Paid',
     close:demoDate(-33), amount:505000, fee:12625, paid:demoDate(-26), invoice:'INV-2031', due:demoDate(-19)},
    {id:'demo-x0', relId:'ARP-104766', agentId:'demo-a5', agent:'Callie Mercer', kind:'Sale', status:'Paid',
     close:demoDate(-71), amount:615000, fee:15375, paid:demoDate(-64), invoice:'INV-2019', due:demoDate(-57)},
    {id:'demo-x2', relId:'ARP-104766', agentId:'demo-a5', agent:'Callie Mercer', kind:'Purchase', status:'Invoiced',
     close:demoDate(-9), amount:940000, fee:23500, paid:false, invoice:'INV-2044', due:demoDate(21)},
    {id:'demo-x3', relId:'ARP-104821', agentId:'demo-a1', agent:'Marguerite Iselin', kind:'Purchase', status:'Pending',
     close:demoDate(44), amount:772000, fee:19300, paid:false, invoice:null, due:null},
    {id:'demo-x4', relId:'ARP-104793', agentId:'demo-a4', agent:'Tomas Berglund', kind:'Purchase', status:'Overdue',
     close:demoDate(-46), amount:1088000, fee:27200, paid:false, invoice:'INV-2038', due:demoDate(-11)},
  ];

  transactions.forEach(t=>{ t.company = coName[t.relId] || 'Direct client'; t.channel = 'Corporate'; });

  const notifications = [
    {id:'demo-n1', ts:demoISO(0,'11:20'), kind:'milestone', text:'Offer accepted on ARP-104821', rel:'ARP-104821', read:false},
    {id:'demo-n2', ts:demoISO(1,'09:41'), kind:'milestone', text:'Closing scheduled for ARP-104766', rel:'ARP-104766', read:false},
    {id:'demo-n3', ts:demoISO(3,'10:08'), kind:'task', text:'Agent shortlist ready for review', rel:'ARP-104830', read:true},
  ];

  const contacts = [
    {id:'demo-ct1', companyId:'demo-c2', name:'Imani Roswell', title:'Director, People Operations',
     email:'imani.roswell@verrickcapital.com', phone:'(704) 555-0130', primary:true},
    {id:'demo-ct2', companyId:'demo-c1', name:'Alanna Prewitt', title:'Head of Talent',
     email:'a.prewitt@haldenbio.com', phone:'(617) 555-0166', primary:true},
    {id:'demo-ct3', companyId:'demo-c3', name:'Ruben Okafor', title:'Mobility Manager',
     email:'r.okafor@northbaysys.com', phone:'(206) 555-0111', primary:true},
  ];

  const docs = [
    {id:'demo-d1', name:'Inspection report \u2014 1420 Ferndell Way.pdf', cat:'Inspection', rel:'ARP-104821',
     date:demoISO(1).slice(0,10), size:2418000, type:'application/pdf', employerVisible:false},
    {id:'demo-d2', name:'Relocation policy summary.pdf', cat:'Policy', rel:'ARP-104766',
     date:demoISO(80).slice(0,10), size:412000, type:'application/pdf', employerVisible:true},
    {id:'demo-d3', name:'Arrival market report \u2014 Raleigh.pdf', cat:'Market report', rel:'ARP-104821',
     date:demoISO(55).slice(0,10), size:1180000, type:'application/pdf', employerVisible:true},
  ];

  const directInquiries = [
    {id:'DIR-2088', uuid:'demo-di1', name:'Harriet Lowen', email:'h.lowen@fastmail.com', phone:'(919) 555-0183',
     origin:'Columbus, OH', dest:'Raleigh, NC', mode:'Buyer', stage:'New', notes:'Moving for a spouse\u2019s job, no corporate programme.'},
    {id:'DIR-2089', uuid:'demo-di2', name:'Peter Nakamura', email:'pnakamura@mail.com', phone:'(206) 555-0159',
     origin:'Portland, OR', dest:'Seattle, WA', mode:'Renter', stage:'Contacted', notes:'Wants a rental near light rail.'},
  ];

  const referrals = [
    {id:'demo-rf1', referrer:'Bettina Hark', refEmail:'b.hark@corriden.com', relation:'Former client',
     referred:'Yolanda Sperry', invited:demoISO(20), opened:demoISO(19), status:'Opened',
     notes:'Colleague relocating to Nashville in the spring.'},
  ];

  return {rel, ag, co, profiles, activity, tasks, threads, candidates, opportunities,
          transactions, notifications, contacts, docs, directInquiries, referrals};
}

function demoSeed(){
  const f = demoFixture();
  S.relocations   = f.rel;
  S.agents        = f.ag;
  S.companies     = f.co;
  S.profiles      = f.profiles;
  S.activity      = f.activity;
  S.tasks         = f.tasks;
  S.threads       = f.threads;
  S.candidates    = f.candidates;
  S.opportunities = f.opportunities;
  S.transactions  = f.transactions;
  S.notifications = f.notifications;
  S.contacts      = f.contacts;
  S.docs          = f.docs;
  S.directInquiries = f.directInquiries;
  S.referrals     = f.referrals;
  S.monthly       = Data.monthlyRollup(S.relocations);
}

function demoSignIn(roleKey){
  const u = DEMO_USERS[roleKey]; if(!u) return;

  /* Same opening as a real sign-in. A magic-link return spends a beat on
     bootSplash() while Auth.restore() and the first load run; the demo has
     nothing to wait for, so without this it snaps straight into a populated
     workspace and reads as a different product. Show the same screen. */
  const app = document.getElementById('app');
  if(app) app.innerHTML = bootSplash();

  DEMO = true;
  ME = Object.assign({}, u, {at:Date.now()});
  AUTH_STATE = 'ok';
  setViewAs(null);
  demoSeed();
  try{ sessionStorage.setItem(LS_DEMO, roleKey); }catch(e){}

  setTimeout(()=>{
    nav(roleHome(ME.role));
    toast('Demo workspace open', u.name + ' \u2014 ' + u.org + '. Every record here is fictional.', 'ok');
  }, 5000);
}

function demoRestore(){
  let k = null; try{ k = sessionStorage.getItem(LS_DEMO); }catch(e){}
  if(!k || !DEMO_USERS[k]) return false;
  DEMO = true;
  ME = Object.assign({}, DEMO_USERS[k], {at:Date.now()});
  demoSeed();
  return true;
}

function demoEnd(){
  DEMO = false;
  try{ sessionStorage.removeItem(LS_DEMO); }catch(e){}
  clearSession();
}

function demoBanner(){
  if(!DEMO) return '';
  return '<div style="background:var(--gold-deep);color:#fff;padding:7px 18px;font-size:12.5px;display:flex;' +
    'align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;text-align:center">' +
    '<b>Demo workspace</b><span style="opacity:.8">Signed in as ' + esc(ME ? ME.name : '') +
    '. Every person, company and transaction here is fictional, and nothing you change is saved.</span>' +
    '<button class="linklike" style="color:#fff;text-decoration:underline;font-size:12.5px" onclick="doLogout()">Leave demo</button></div>';
}
