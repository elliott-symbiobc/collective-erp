#!/usr/bin/env node
'use strict';

/**
 * generate_rd_plan.js — Internal R&D Plan DOCX generator for Symbio.
 *
 * Usage:
 *   node generate_rd_plan.js <substrate_id>
 *
 * Outputs the filepath of the generated DOCX to stdout.
 */

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  Document, Paragraph, TextRun, Table, TableRow, TableCell,
  Packer, AlignmentType, BorderStyle, WidthType, ShadingType,
  Header, Footer, PageNumber, VerticalAlign,
} = require('docx');

// ── Args ───────────────────────────────────────────────────────────────────
const substrateId = process.argv[2];
if (!substrateId) {
  console.error('Usage: node generate_rd_plan.js <substrate_id>');
  process.exit(1);
}

// ── DB pool ────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Colour constants (SBC brand) ────────────────────────────────────────────
const NAVY       = '000000';   // black for H1
const GREEN_TEXT = '166534';
const AMBER_TEXT = '92400E';
const RED_TEXT   = 'C31010';   // Thunderbird Red
const GREY_TEXT  = '4B5563';
const BLACK_TEXT = '111827';
const HEADER_FILL = '8B1414';  // dark red table headers
const ALT_FILL    = 'EEECE1';  // Satin Linen alternating rows

// ── Formatting ─────────────────────────────────────────────────────────────
const fmt$   = (n) => n != null ? `$${Number(n).toFixed(2)}/kg` : '—';
const fmtM   = (n) => n != null ? `$${(Number(n) / 1_000_000).toFixed(1)}M`  : '—';
const fmtPct = (n) => n != null ? `${Number(n).toFixed(1)}%` : '—';
const fmtN   = (n, d = 1) => n != null ? Number(n).toFixed(d) : '—';

// ── Low-level DOCX helpers ──────────────────────────────────────────────────

function run(text, opts = {}) {
  return new TextRun({ text: String(text ?? '—'), font: 'Calibri', size: 22, color: BLACK_TEXT, ...opts });
}

function boldRun(text, opts = {}) {
  return run(text, { bold: true, ...opts });
}

function para(children, opts = {}) {
  const c = typeof children === 'string' ? [run(children)] : children;
  return new Paragraph({ children: c, spacing: { before: 120, after: 120 }, ...opts });
}

function heading1(text, pageBreak = false) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: '000000', font: 'Calibri', size: 40 })],
    spacing: { before: 560, after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C31010' } },
    ...(pageBreak ? { pageBreakBefore: true } : {}),
  });
}

function heading2(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: 'C31010', font: 'Calibri', size: 28 })],
    spacing: { before: 360, after: 160 },
  });
}

function bullet(text) {
  return new Paragraph({
    children: [run(text)],
    bullet: { level: 0 },
    spacing: { before: 40, after: 40 },
  });
}

function spacer() {
  return new Paragraph({ children: [run('')], spacing: { before: 160, after: 160 } });
}

function th(label, align = AlignmentType.LEFT, w = null) {
  const cell = {
    children: [new Paragraph({
      children: [new TextRun({ text: String(label ?? ''), bold: true, color: 'FFFFFF', font: 'Calibri', size: 20 })],
      alignment: align,
      spacing: { before: 60, after: 60 },
    })],
    shading: { fill: '8B1414', type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  };
  if (w) cell.width = { size: w, type: WidthType.DXA };
  return new TableCell(cell);
}

function td(value, shaded = false, color = BLACK_TEXT, w = null) {
  const isObj = value !== null && typeof value === 'object';
  const text  = isObj ? String(value.text ?? '—') : String(value ?? '—');
  const col   = isObj && value.color ? value.color : color;
  const bold  = isObj && value.bold  ? true : false;
  const align = isObj && value.align ? value.align : AlignmentType.LEFT;
  const cell = {
    children: [new Paragraph({
      children: [new TextRun({ text, font: 'Calibri', size: 20, color: col, bold })],
      alignment: align,
      spacing: { before: 60, after: 60 },
    })],
    shading: shaded ? { fill: 'EEECE1', type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
  };
  if (w) cell.width = { size: w, type: WidthType.DXA };
  return new TableCell(cell);
}

function simpleTable(headers, rows, colWidths = null) {
  const n = headers.length;
  const CONTENT_W = 10080; // twips: Letter page minus 2×0.75in margins
  const even = Math.floor(CONTENT_W / n);
  const widths = colWidths || Array(n).fill(even);

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) =>
          typeof h === 'string' ? th(h, AlignmentType.LEFT, widths[i]) : th(h.text, h.align || AlignmentType.LEFT, widths[i])
        ),
      }),
      ...rows.map((cells, ri) =>
        new TableRow({
          children: cells.map((c, ci) => td(c, ri % 2 === 1, BLACK_TEXT, widths[ci])),
        })
      ),
    ],
  });
}

// ── Data fetching ──────────────────────────────────────────────────────────

async function fetchData(subId) {
  const client = await pool.connect();
  try {
    // Substrate
    const subRes = await client.query('SELECT * FROM substrates WHERE substrate_id = $1', [subId]);
    if (subRes.rows.length === 0) throw new Error(`Substrate ${subId} not found`);
    const sub = subRes.rows[0];

    // Best TEA result
    const teaRes = await client.query(
      `SELECT * FROM substrate_tea_results
       WHERE substrate_id = $1
       ORDER BY viability_rank ASC NULLS LAST LIMIT 1`,
      [subId]
    );
    const tea = teaRes.rows[0] || null;

    // All TEA results
    const allTeaRes = await client.query(
      `SELECT candidate_output, recommendation, mpsp_usd_kg, npv_usd, irr_pct, viability_rank
       FROM substrate_tea_results
       WHERE substrate_id = $1
       ORDER BY viability_rank ASC NULLS LAST`,
      [subId]
    );
    const allTea = allTeaRes.rows;

    // Top strains (scored via strain_cazyme_features for composition)
    const strainsRes = await client.query(
      `SELECT st.name, cf.gh13_count, cf.gh10_count,
              cf.aa9_count, cf.ce1_count, cf.cazyme_density
       FROM strains st
       LEFT JOIN LATERAL (
         SELECT * FROM strain_cazyme_features
         WHERE strain_id = st.strain_id
         ORDER BY annotation_date DESC NULLS LAST LIMIT 1
       ) cf ON TRUE
       ORDER BY cf.cazyme_density DESC NULLS LAST
       LIMIT 5`
    );
    const topStrains = strainsRes.rows;

    // Top genome edits
    const editsRes = await client.query(
      `SELECT ge.target_gene, ge.edit_type, ge.feature_name, ge.priority_score,
              ge.delta_titer_estimate, st.name AS strain_name
       FROM genome_edits ge
       JOIN strains st ON st.strain_id = ge.strain_id
       WHERE ge.substrate_id = $1
       ORDER BY ge.priority_score DESC NULLS LAST
       LIMIT 8`,
      [subId]
    );
    const edits = editsRes.rows;

    // Compound opportunities
    const compRes = await client.query(
      `SELECT sco.compound_name, sco.confidence, sco.market_value_signal,
              sco.review_status, sco.novelty_flag, st.name AS strain_name
       FROM strain_compound_opportunities sco
       JOIN strains st ON st.strain_id = sco.strain_id
       WHERE sco.substrate_id = $1
         AND sco.review_status != 'rejected'
       ORDER BY sco.confidence DESC NULLS LAST
       LIMIT 10`,
      [subId]
    );
    const compounds = compRes.rows;

    // Regulatory status for top compounds
    const compoundNames = compounds.map(c => c.compound_name);
    let regulatory = [];
    if (compoundNames.length > 0) {
      const regRes = await client.query(
        `SELECT DISTINCT ON (ors.compound_name)
                ors.compound_name, ors.jurisdiction, ors.status_label,
                ors.novel_food_flag, ors.gras_flag
         FROM organism_regulatory_status ors
         WHERE ors.compound_name = ANY($1)
         ORDER BY ors.compound_name, ors.jurisdiction`,
        [compoundNames]
      );
      regulatory = regRes.rows;
    }

    return { sub, tea, allTea, topStrains, edits, compounds, regulatory };
  } finally {
    client.release();
  }
}

// ── Cover page ─────────────────────────────────────────────────────────────

function buildCover(sub, tea) {
  const recColor = !tea ? GREY_TEXT
    : tea.recommendation === 'GO' ? GREEN_TEXT
    : tea.recommendation === 'HOLD' ? AMBER_TEXT
    : RED_TEXT;

  return [
    spacer(), spacer(), spacer(), spacer(),
    new Paragraph({
      children: [new TextRun({ text: 'SYMBIO BIOCULINARY', bold: true, color: 'C31010', font: 'Calibri', size: 28 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'INTERNAL R&D PLAN', bold: true, color: '000000', font: 'Calibri', size: 56 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C31010' } },
    }),
    spacer(),
    new Paragraph({
      children: [new TextRun({ text: sub.name, bold: true, color: '000000', font: 'Calibri', size: 44 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
    }),
    sub.source_partner ? new Paragraph({
      children: [new TextRun({ text: sub.source_partner, color: GREY_TEXT, font: 'Calibri', size: 24 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 200 },
    }) : spacer(),
    tea ? new Paragraph({
      children: [new TextRun({ text: `TEA Recommendation: ${tea.recommendation ?? '—'}`, bold: true, color: recColor, font: 'Calibri', size: 28 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 400 },
    }) : spacer(),
    new Paragraph({
      children: [new TextRun({ text: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), color: GREY_TEXT, font: 'Calibri', size: 22 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
    }),
    spacer(), spacer(),
    new Paragraph({
      children: [new TextRun({ text: 'CONFIDENTIAL — Prepared by Symbio Bioculinary', color: GREY_TEXT, font: 'Calibri', size: 18, italics: true })],
      alignment: AlignmentType.CENTER,
    }),
  ];
}

// ── Executive Summary ──────────────────────────────────────────────────────

function buildExecSummary(sub, tea, allTea) {
  const items = [];
  items.push(heading1('1. Executive Summary', true));

  items.push(para([
    boldRun('Substrate: '), run(sub.name),
    ...(sub.source_partner ? [run(' ('), run(sub.source_partner), run(')')] : []),
  ]));

  if (tea) {
    items.push(para([
      boldRun('TEA Recommendation: '),
      run(tea.recommendation ?? '—', {
        color: tea.recommendation === 'GO' ? GREEN_TEXT : tea.recommendation === 'HOLD' ? AMBER_TEXT : RED_TEXT,
        bold: true,
      }),
    ]));
    items.push(para([boldRun('Best-Case MPSP: '), run(fmt$(tea.mpsp_usd_kg))]));
    items.push(para([boldRun('NPV: '), run(fmtM(tea.npv_usd)), run('  |  IRR: '), run(fmtPct(tea.irr_pct))]));
  } else {
    items.push(para('TEA model results are pending.'));
  }

  items.push(spacer());
  items.push(heading2('Output Scenarios'));
  if (allTea.length > 0) {
    items.push(simpleTable(
      ['Output Type', 'Recommendation', 'MPSP', 'NPV', 'IRR'],
      allTea.map(t => [
        t.candidate_output ?? '—',
        t.recommendation ?? 'Pending',
        fmt$(t.mpsp_usd_kg),
        fmtM(t.npv_usd),
        fmtPct(t.irr_pct),
      ])
    ));
  } else {
    items.push(para('No TEA results available yet.'));
  }

  return items;
}

// ── Biological Strategy ────────────────────────────────────────────────────

function buildBioStrategy(sub, topStrains) {
  const items = [];
  items.push(heading1('2. Biological Strategy', true));
  items.push(para('This section summarises the enzymatic and strain-level factors driving substrate conversion.'));

  items.push(spacer());
  items.push(heading2('Substrate Composition'));

  const compRows = [];
  if (sub.pct_starch != null)       compRows.push(['Starch', fmtPct(sub.pct_starch)]);
  if (sub.pct_cellulose != null)    compRows.push(['Cellulose', fmtPct(sub.pct_cellulose)]);
  if (sub.pct_hemicellulose != null) compRows.push(['Hemicellulose', fmtPct(sub.pct_hemicellulose)]);
  if (sub.pct_pectin != null)       compRows.push(['Pectin', fmtPct(sub.pct_pectin)]);
  if (sub.pct_lignin != null)       compRows.push(['Lignin', fmtPct(sub.pct_lignin)]);
  if (sub.pct_protein != null)      compRows.push(['Protein', fmtPct(sub.pct_protein)]);
  if (sub.cn_ratio != null)         compRows.push(['C:N Ratio', fmtN(sub.cn_ratio)]);
  if (sub.ph_native != null)        compRows.push(['pH (native)', fmtN(sub.ph_native)]);
  if (compRows.length > 0) {
    items.push(simpleTable(['Component', 'Value'], compRows));
  }

  items.push(spacer());
  items.push(heading2('Top Candidate Strains'));
  if (topStrains.length > 0) {
    items.push(simpleTable(
      ['Strain', 'GH13', 'GH10', 'AA9', 'CE1', 'CAZyme Density'],
      topStrains.map(s => [
        s.name,
        s.gh13_count ?? '—',
        s.gh10_count ?? '—',
        s.aa9_count ?? '—',
        s.ce1_count ?? '—',
        s.cazyme_density != null ? s.cazyme_density.toFixed(4) : '—',
      ])
    ));
  } else {
    items.push(para('No annotated strains available.'));
  }

  return items;
}

// ── Experimental Plan ──────────────────────────────────────────────────────

function buildExperimentalPlan(edits) {
  const items = [];
  items.push(heading1('3. Experimental Plan', true));

  items.push(heading2('3.1 Genome Engineering Targets'));
  if (edits.length > 0) {
    items.push(simpleTable(
      ['Gene / Feature', 'Edit Type', 'Strain', 'Priority', 'ΔTITER (est.)'],
      edits.map(e => [
        e.target_gene ?? e.feature_name ?? '—',
        e.edit_type ?? '—',
        e.strain_name,
        e.priority_score != null ? Number(e.priority_score).toFixed(2) : '—',
        e.delta_titer_estimate != null ? `+${Number(e.delta_titer_estimate).toFixed(2)} U/mL` : '—',
      ])
    ));
  } else {
    items.push(para('No genome edits generated yet. Use the Strains page to generate CRISPR edit packages.'));
  }

  items.push(spacer());
  items.push(heading2('3.2 Fermentation Conditions'));
  items.push(bullet('Solid-state fermentation recommended for fibrous substrates (Aw < 0.96)'));
  items.push(bullet('Initial pH adjustment to strain pH optimum before inoculation'));
  items.push(bullet('Monitor enzyme titer at 48 h, 72 h, and 96 h intervals'));
  items.push(bullet('Triplicate runs per strain × substrate pair for statistical validity'));
  items.push(bullet('Control: blank substrate with no inoculation'));

  items.push(spacer());
  items.push(heading2('3.3 Analytical Endpoints'));
  items.push(bullet('Enzyme titer (U/mL) via colorimetric assay (primary output)'));
  items.push(bullet('Biomass yield (g dry weight)'));
  items.push(bullet('Time-to-peak titer (h)'));
  items.push(bullet('Metabolite profiling by LC-MS for compound discovery validation'));

  return items;
}

// ── R&D Timeline ───────────────────────────────────────────────────────────

function buildTimeline() {
  const milestones = [
    ['Month 1–2',   'Substrate characterisation, strain selection, culture optimisation'],
    ['Month 3–4',   'Pilot fermentation runs (replicate triplicate sets)'],
    ['Month 5–6',   'CRISPR strain engineering (top 2 edit packages)'],
    ['Month 7–8',   'Engineered strain validation, secondary metabolite profiling'],
    ['Month 9–10',  'Scale-up to 10 L bioreactor; process optimisation'],
    ['Month 11–12', 'Techno-economic review, regulatory pre-submission dossier'],
  ];

  return [
    heading1('4. R&D Timeline', true),
    para('Estimated project timeline from substrate approval to scale-up readiness.'),
    spacer(),
    simpleTable(['Period', 'Milestone'], milestones),
  ];
}

// ── Regulatory Strategy ────────────────────────────────────────────────────

function buildRegulatoryStrategy(compounds, regulatory) {
  const items = [];
  items.push(heading1('5. Regulatory Strategy', true));

  items.push(para('This section outlines regulatory considerations for candidate compounds identified through dark-chemistry discovery.'));

  items.push(spacer());
  items.push(heading2('5.1 Compound Candidates'));
  if (compounds.length > 0) {
    items.push(simpleTable(
      ['Compound', 'Strain', 'Confidence', 'Market Signal', 'Novel'],
      compounds.map(c => [
        c.compound_name,
        c.strain_name,
        c.confidence != null ? fmtPct(c.confidence * 100) : '—',
        c.market_value_signal ?? '—',
        c.novelty_flag ? 'Yes' : 'No',
      ])
    ));
  } else {
    items.push(para('No approved compound opportunities for this substrate yet.'));
  }

  items.push(spacer());
  items.push(heading2('5.2 Regulatory Status'));
  if (regulatory.length > 0) {
    items.push(simpleTable(
      ['Compound', 'Jurisdiction', 'Status', 'GRAS', 'Novel Food'],
      regulatory.map(r => [
        r.compound_name,
        r.jurisdiction,
        r.status_label ?? '—',
        r.gras_flag ? 'Yes' : 'No',
        r.novel_food_flag ? 'Required' : 'Not required',
      ])
    ));
  } else {
    items.push(para('No regulatory status entries found. Run regulatory screening via the Compounds page.'));
  }

  items.push(spacer());
  items.push(heading2('5.3 Recommended Next Steps'));
  items.push(bullet('Submit GRAS self-affirmation notices for any compounds with prior safety data'));
  items.push(bullet('Initiate EU Novel Food pre-submission inquiry for novel compounds'));
  items.push(bullet('File IP disclosure for compounds with novelty_flag = true'));
  items.push(bullet('Consult regulatory counsel before initiating animal safety studies'));

  return items;
}

// ── TEA Context ────────────────────────────────────────────────────────────

function buildTeaContext(tea, allTea) {
  const items = [];
  items.push(heading1('6. TEA Context', true));
  items.push(para('Techno-economic analysis provides the economic guardrails for process development decisions.'));

  if (!tea) {
    items.push(para('TEA model results are not yet available for this substrate.'));
    return items;
  }

  items.push(spacer());
  items.push(heading2('Key Economic Indicators'));
  items.push(simpleTable(
    ['Metric', 'Value'],
    [
      ['Minimum Product Selling Price (MPSP)', fmt$(tea.mpsp_usd_kg)],
      ['Net Present Value (NPV)', fmtM(tea.npv_usd)],
      ['Internal Rate of Return (IRR)', fmtPct(tea.irr_pct)],
      ['Viability Rank', tea.viability_rank ?? '—'],
      ['Recommendation', tea.recommendation ?? '—'],
    ]
  ));

  items.push(spacer());
  items.push(heading2('Implications for R&D'));
  if (tea.recommendation === 'GO') {
    items.push(bullet('Economics are favourable — accelerate experimental timeline'));
    items.push(bullet('Prioritise yield improvement experiments to widen NPV margin'));
    items.push(bullet('Begin partner engagement for commercial scale-up discussions'));
  } else if (tea.recommendation === 'HOLD') {
    items.push(bullet('Economics are marginal — focus R&D on cost reduction levers'));
    items.push(bullet('Sensitivity analysis indicates titer and substrate cost as key drivers'));
    items.push(bullet('Consider alternative output types or substrate blending to improve MPSP'));
  } else {
    items.push(bullet('Current economics do not support commercial development at this stage'));
    items.push(bullet('Re-evaluate substrate if strain engineering can improve titer > 2×'));
    items.push(bullet('Consider redirecting to a different downstream compound with higher value'));
  }

  return items;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  let data;
  try {
    data = await fetchData(substrateId);
  } catch (err) {
    console.error('Data fetch failed:', err.message);
    process.exit(1);
  }

  const { sub, tea, allTea, topStrains, edits, compounds, regulatory } = data;

  const sections = [
    ...buildCover(sub, tea),
    ...buildExecSummary(sub, tea, allTea),
    ...buildBioStrategy(sub, topStrains),
    ...buildExperimentalPlan(edits),
    ...buildTimeline(),
    ...buildRegulatoryStrategy(compounds, regulatory),
    ...buildTeaContext(tea, allTea),
  ];

  const year = new Date().getFullYear();
  const doc = new Document({
    sections: [{
      properties: {},
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'SYMBIO BIOCULINARY  |  INTERNAL R&D PLAN', bold: true, font: 'Calibri', size: 18, color: 'C31010' }),
              ],
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C31010' } },
              spacing: { after: 0 },
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: `CONFIDENTIAL — Prepared by Symbio Bioculinary, ${year}    Page `, font: 'Calibri', size: 16, color: '6B7280' }),
                new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 16, color: '6B7280' }),
              ],
              alignment: AlignmentType.RIGHT,
              border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'C31010' } },
              spacing: { before: 0 },
            }),
          ],
        }),
      },
      children: sections,
    }],
  });

  const outDir = '/app/reports';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const safeName = sub.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `rd_plan_${safeName}_${timestamp}.docx`;
  const filepath = path.join(outDir, filename);

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filepath, buffer);

  // Update rd_report_path for the selected TEA row (or most recent)
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE substrate_tea_results
         SET rd_report_path = $1
         WHERE substrate_id = $2
           AND (selected = true OR tea_id = (
             SELECT tea_id FROM substrate_tea_results
             WHERE substrate_id = $2
             ORDER BY viability_rank ASC NULLS LAST
             LIMIT 1
           ))`,
        [filepath, substrateId]
      );
    } finally {
      client.release();
    }
  } catch (err) {
    // DB update is best-effort; file is still written
    process.stderr.write(`DB update failed: ${err.message}\n`);
  }

  console.log(filepath);
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
