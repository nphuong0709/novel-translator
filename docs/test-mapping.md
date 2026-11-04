# Ánh xạ test Python V1 → quirk → test TS

Test Python nằm trong project V1 (`tests/*.py`). Chỉ liệt kê test **liên quan tới ingest**; test về OpenAI, Google Docs, pipeline dịch không chuyển sang.

| Test Python V1 | Quirk | Test TS |
|---|---|---|
| `test_69shuba_crawler::test_normalize_69shuba_book_url` | SHUBA-01 | `golden.shuba69.test.ts › normalizeBookUrl` |
| `::test_parse_69shuba_catalog` | SHUBA-02 | `› parseCatalogHtml (title)` |
| `::test_catalog_supports_chinese_numerals_and_warns_duplicates` | SHUBA-02, CORE-01 | `› parseCatalogHtml (title)` |
| `::test_catalog_order_mode_numbers_by_url_id` | SHUBA-03 | `› parseCatalogHtml (order)` |
| `::test_parse_69shuba_chapter_uses_direct_text_and_drops_ads` | SHUBA-04 | `› parseChapterHtml chapter-basic` |
| `::test_parse_chapter_drops_promo_lines_but_keeps_scene_break` | SHUBA-06 | `› parseChapterHtml chapter-promo` |
| `::test_parse_chapter_drops_repeated_heading_variant` | SHUBA-05 | `› parseChapterHtml chapter-repeated-heading` |
| `::test_custom_junk_patterns_are_applied` | CORE-03, CORE-04 | `junk.test.ts` (spec) |
| `::test_invalid_junk_pattern_raises_clear_error` | CORE-04 | `junk.test.ts` (spec) |
| `::test_clean_content_for_legacy_raw` | CORE-03 | `junk.test.ts` (spec) |
| `::test_chinese_numeral_to_int` (9 case) | CORE-01 | `golden.core.test.ts › chineseNumeralToInt` |
| `::test_chapter_number_from_title` | CORE-02 | `golden.core.test.ts › chapterNumberFromTitle` |
| `::test_with_retries_recovers_from_transient_error` | CORE-05 | `retry.test.ts` (spec) |
| `::test_with_retries_gives_up_and_does_not_retry_blocked` | CORE-05 | `retry.test.ts` (spec) |
| `::test_catalog_cache_avoids_reloading_and_refreshes_for_new_chapter` | SHUBA-09 | `shuba69.cache.test.ts` (spec) |
| `test_52shuku_crawler::test_provider_detection_and_language` | — | `adapters.test.ts › matches()` (spec) |
| `::test_normalize_index_url` | SHUKU-01 | `golden.shuku52.test.ts › normalizeIndexUrl` |
| `::test_heading_detection_ignores_sentences` | SHUKU-05 | `› headingNumber` |
| `::test_inline_chapter_reference_is_not_a_heading` | SHUKU-05 | `› headingNumber` |
| `::test_chapter_spanning_pages_is_stitched_and_cleaned` | SHUKU-06, SHUKU-07 | `› fetchChapter` |
| `::test_middle_and_last_chapter` | SHUKU-07, SHUKU-09 | `› fetchChapter` |
| `::test_unclosed_last_paragraph_keeps_heading_and_drops_pagination` | SHUKU-03 | `› parsePageHtml` |
| `::test_page_cache_avoids_refetch` | SHUKU-10 | `shuku52.cache.test.ts` (spec) |
| `::test_old_page_cache_without_parser_version_is_refetched` | SHUKU-10, CORE-12 | `shuku52.cache.test.ts` (spec) |
| `::test_binary_search_does_not_fetch_every_page` | SHUKU-08 | `› fetchChapter (đếm request)` |
| `test_crawl_pipeline::test_crawl_only_saves_raw_and_meta_then_skips` | CORE-13 | `ingest.test.ts` (spec) |
| `::test_crawl_only_keeps_translation_status` | D-07 | không cần: trạng thái được tính lại từ artifact |
| `::test_crawl_only_stops_after_consecutive_failures` | CORE-06 | `ingest.test.ts` (spec) |
| `::test_crawl_only_stops_immediately_when_blocked` | CORE-06 | `ingest.test.ts` (spec) |
| `::test_duplicate_neighbor_content_is_rejected` | CORE-07 | `checks.test.ts` (spec) |
| `::test_short_chapter_produces_warning` | CORE-08 | `checks.test.ts` (spec, thêm case quá dài) |
| `::test_run_uses_cached_raw_without_crawling_and_cleans_legacy_junk` | CORE-13, CORE-03 | `ingest.test.ts` (spec) |
| `::test_run_recrawl_flag_forces_crawl` | CORE-13 | `ingest.test.ts` (spec) |
| `::test_run_stops_after_consecutive_crawl_failures` | CORE-06 | `ingest.test.ts` (spec) |
| `test_progress::*` | CORE-11 | `raw-store.test.ts` (spec) |
| *(mới, V1 không có)* | CORE-09, CORE-10, CORE-12 | `checks.test.ts`, `lock.test.ts`, `raw-store.test.ts` |

Trong Slice 1, golden test (`golden.*.test.ts`) được viết trước, ngay khi dựng khung. Các test **spec** sẽ viết dần theo thứ tự port ở blueprint mục 8.

Sinh lại golden (chỉ khi cố ý đổi hành vi, và phải ghi lý do vào commit):

```bash
cd <project V1> && .venv/bin/python tools/export_golden.py ~/Documents/2.phuong-nguyen/novel-translator
```
