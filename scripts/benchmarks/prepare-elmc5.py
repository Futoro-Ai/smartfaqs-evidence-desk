#!/usr/bin/env python3
"""Regenerate a local-only ELM5 Docling export from a pinned public PDF."""
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / ".local/benchmarks/semantic/elm"
PDF_SHA256 = "652d1612fdff0bb6e85546b981db5ddc59496ad7a27b65c5e88b5efb6b24de95"


def main():
    if version("docling") != "2.130.0":
        raise ValueError("unapproved_docling_version")
    TARGET.mkdir(parents=True, exist_ok=True)
    pdf = TARGET / "elmc5.pdf"
    if not pdf.exists():
        request = urllib.request.Request("https://about.usps.com/manuals/elm/elmc5.pdf",
                                         headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read(6 * 1024 * 1024 + 1)
        if len(data) > 6 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != PDF_SHA256:
            raise ValueError("elm_pdf_checksum_mismatch")
        pdf.write_bytes(data)
    if hashlib.sha256(pdf.read_bytes()).hexdigest() != PDF_SHA256:
        raise ValueError("elm_pdf_checksum_mismatch")
    output = TARGET / "elmc5.jsonl"
    if output.exists():
        raise ValueError("elm_export_already_exists")
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
    from docling_core.types.doc import DocItemLabel, TableItem, TextItem
    options = PdfPipelineOptions()
    options.do_ocr = False
    options.do_table_structure = True
    options.table_structure_options.mode = TableFormerMode.ACCURATE
    options.enable_remote_services = False
    doc = DocumentConverter(format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_options=options),
    }).convert(pdf).document
    headings = [("5", "5 Employee Benefits")]
    rows, table_count, heading_count = [], 0, 0
    for item, _level in doc.iterate_items():
        if isinstance(item, TableItem):
            text = item.export_to_markdown(doc=doc)
            kind = "table"
            table_count += 1
        elif isinstance(item, TextItem):
            if item.label in (DocItemLabel.PAGE_HEADER, DocItemLabel.PAGE_FOOTER):
                continue
            text, kind = item.text.strip(), "text"
            if item.label in (DocItemLabel.SECTION_HEADER, DocItemLabel.TITLE):
                match = re.match(r"^(5\d{2}(?:\.\d+)?)\s+", text)
                if match:
                    number = match.group(1)
                    headings = [(code, label) for code, label in headings
                                if number.startswith(code) and number != code]
                    headings.append((number, text))
                kind = "heading_only"
                heading_count += 1
        else:
            continue
        if text:
            rows.append({
                "text": text, "chunk_index": len(rows), "chunk_type": kind,
                "heading_path_v2": [label for _, label in headings],
                "page_start": min((p.page_no for p in item.prov), default=None),
            })
    if table_count < 10 or not rows:
        raise ValueError("elm_table_extraction_incomplete")
    data = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode()
    output.write_bytes(data)
    doc.save_as_json(TARGET / "elmc5.docling.json")
    receipt = {
        "schemaVersion": "smartfaqs-elm-preparation.v1", "doclingVersion": version("docling"),
        "pdfSha256": PDF_SHA256, "exportSha256": hashlib.sha256(data).hexdigest(),
        "pageCount": len(doc.pages), "recordCount": len(rows),
        "tableCount": table_count, "headingOnlyCount": heading_count,
        "rightsClass": "local_private_only",
        "note": "Docling regeneration in Evidence Desk only; not an ingestion or database mutation.",
    }
    (TARGET / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
