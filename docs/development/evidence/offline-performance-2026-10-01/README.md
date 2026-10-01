# Local Chromium performance attempts

Command: `pnpm quality:performance:collect -- --browsers=chromium --backend=all`.
Only preinstalled dependencies/browsers and checked-in media were used. No download or installation occurred.

- `11-56-59/`: all four Native/Custom × isolation smoke rows passed their measured thresholds.
- `12-21-01/`: Native rows passed; Custom seek took 1105.4 ms (MessagePort) and 1094.8 ms (SAB),
  exceeding the unchanged 1000 ms threshold. These failures are preserved, not approved baselines.
- `13-05-52/`: all four rows passed after adding a per-Cluster, bounded 64 KiB read-ahead window to
  WebM/Matroska packet reads. Custom seek took 17.40 ms (MessagePort) and 17.45 ms (SAB), with
  first frame at 165.30/165.20 ms. Native seek took 9.00/14.58 ms and first frame 125.20/98.22 ms
  (non-isolated/isolated). The sample and thresholds are unchanged.

The second run followed a UI screenshot baseline refresh; reports carry their actual source fingerprints.
The third run fixes the many small Range requests previously needed to parse a Cluster. These measurements
are local short-sample observations, not general latency guarantees or long-run evidence.
`status: passed` means the browser completed the scripted run. `validation.passed` determines whether its
measured thresholds passed. Neither means physical-browser, long-run or production acceptance.

Physical first audio, A/V drift and CPU remain unavailable. Submission drift and observed PCM consumption
are separate diagnostics. These partial local matrices must not be copied into release baselines as a full
browser/isolation acceptance matrix. Firefox/WebKit, physical Safari, Docker and 30-minute acceptance remain
pending; the strict release gate rejects the current repository.
