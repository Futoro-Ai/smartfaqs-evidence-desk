# Third-Party Notices

## Ponytail Development Guidance

Repository-local agent guidance in `AGENTS.md` incorporates text from Ponytail:

- Project: https://github.com/DietrichGebert/ponytail
- Commit: `2ed6c52c9d7e5e56942508591085fd45dea277d3`
- Copyright (c) 2026 DietrichGebert
- License: MIT

Ponytail is development guidance only. It is not a runtime dependency and no
Ponytail hooks, plugin code, telemetry, or external service is deployed by this
application.

```text
MIT License

Copyright (c) 2026 DietrichGebert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Optional SciFact Benchmark Data

The repository includes an optional downloader and evaluation adapter for the
SciFact dataset but does not distribute the dataset itself.

- Project: https://github.com/allenai/scifact
- Claims and evidence annotations: CC BY 4.0
- Abstract corpus from S2ORC: ODC-By 1.0
- Upstream code: Apache-2.0

Downloaded data and benchmark results remain in the Git-ignored `.local/`
directory. The upstream licenses and attribution requirements continue to
apply to anyone who downloads or uses the benchmark data.
