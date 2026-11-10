# SCOPE — phạm vi seller-hub (P1-SCOPE, Gate 1)

Tổng hợp từ 7 kết quả P1: `docs/discovery/{spapi-domains, ads-domains, ads-mcp, ads-console-features,
legacy-web-features, legacy-api-domain, reference-patterns, feature-ideas, vendor-features}.md`,
`catalog/**`, `docs/reports/P1-*.md`. Ràng buộc: D0 (clean room), D1 c, D2 a, D3 a, D4 US trước,
D5 Seller + Vendor (Seller trước), D11 mặc định không PII, D50 c, D51, D53, D55, D56.

**Cách trả lời Gate 1 (D10):** đánh `[x]` ở cột **MVP?** của bảng §2 cho các dòng bạn muốn trong MVP
(đề xuất của tôi đã ghi ở cột *Đề xuất*), trả lời D11 và các câu ở §7, rồi gõ `duyệt`.

---

## 1. Tóm tắt

- **seller-hub** = web app đa tenant (D1 c) cho bất kỳ seller/vendor nào: **quảng cáo** qua Amazon Ads API
  (v1 mặc định, 20 ngoại lệ v0 có tên — D53) và **vận hành** qua SP-API (listing, tồn kho, đơn hàng,
  tài chính; vendor: PO/ASN/invoice, Retail Analytics), có DB riêng, BFF Next.js, worker BullMQ.
- **Quan hệ với ads-web/ads-api (legacy):** chỉ là nguồn yêu cầu (clean room). Chuẩn chức năng ads là
  **Amazon Ads console** (D51); ads-web đã bắt chước console, nên phần lõi trùng. seller-hub gọi Amazon
  **trực tiếp** bằng token LWA của từng seller (D52), bỏ hẳn 27 lời gọi "console riêng" dùng cookie người
  thật, bỏ mọi khái niệm nội bộ (ticket, phòng ban, duyệt ngân sách, BI iframe, Walmart/Wayfair).
- **Đề xuất MVP** (bảng §2, cột *Đề xuất* = `MVP·L0` rồi `MVP`):
  1. **Lát 0 (L0, mỏng, đầu-cuối):** đăng nhập/tenant → kết nối tài khoản Ads → đồng bộ campaign/target
     SP + báo cáo ngày → màn Campaign Manager (đọc) → **một luật bid** (ACOS cao → giảm bid, có preview,
     duyệt, giới hạn, audit). Chứng minh: LWA đa tenant, ingestion có rate limit, ghi 207 an toàn, rule
     engine — tức là toàn bộ "đường ống" khó nhất (ANALYSIS rủi ro 4).
  2. **MVP còn lại:** kết nối SP-API → listing; SP ads đạt parity với màn lõi của ads-web/console (list +
     bulk, tạo campaign SP, chi tiết campaign/ad group, search term, portfolio, lịch sử); rồi tồn kho FBA,
     đơn hàng (không PII), giao dịch tài chính, tổng quan doanh số.
  - MVP chứng minh: một seller tự host (D1 c) quản được SP ads ngang console và thấy listing / tồn kho /
    đơn / tiền trong cùng một chỗ, trên schema đa tenant.
- **Sau MVP (v1):** SB/SD, budget rules + budget recommendations, automation (harvest, negative, pacing,
  dayparting, pause khi hết hàng), lợi nhuận/TACoS, trợ lý AI qua MCP của Amazon (D50 a), **Vendor**
  (PO/ASN/invoice + Retail Analytics — ứng viên MVP nếu bạn cần vendor sớm).
- **Rủi ro lớn nhất (§5):** (1) Amazon duyệt app SP-API/Ads (R5/R6) quyết định khi nào chạy thật;
  (2) Reporting v3 + Stream v1 tắt **2027-06-30** → chỉ xây trên v1 reports + Stream v2, mà độ phủ cột
  search term / placement / impression share của v1 chưa xác nhận; (3) rate limit SP-API rất thấp
  (`searchOrders` ≈ 1 call/3 phút) → bắt buộc report + notification; (4) ghi 207 từng phần;
  (5) logic tự động hoá của legacy không có trong repo → phải thiết kế mới.

---

## 2. Ma trận tính năng

Chú thích:
- **Nguồn:** `LW` legacy-web (ads-web) · `LA` legacy-api (ads-api) · `CON` Ads console (P1-CONSOLE) ·
  `SP` SP-API · `ADS` Ads API · `MCP` Ads MCP · `VC` Vendor Central (P1-VENDOR) · `F-xx` ý tưởng P1-REF
  (`feature-ideas.md`) · `TK` agentic toolkit.
- **Role SP-API** (đăng ký app R5): `PL` Product Listing · `AF` Amazon Fulfillment · `FA` Finance and
  Accounting · `BA` Brand Analytics · `IOT` Inventory and Order Tracking · `PR` Pricing · `*` = restricted
  (cần Amazon duyệt thêm, PII). Ads: scope LWA `advertising::campaign_management`; `EX-*` = ngoại lệ v0 (D53,
  `ads-domains.md` §4). Quyền trong app theo D55 (Owner/Admin/Manager ghi, Analyst đọc + báo cáo, Viewer).
- **Độ lớn:** S ≈ < 1 tuần · M ≈ 1–2 tuần · L ≈ 2–4 tuần · XL > 4 tuần (một session code).
- **Đề xuất:** `MVP·L0` lát cắt đầu tiên · `MVP` · `v1` ngay sau MVP · `sau` roadmap · `ngoài` ngoài phạm vi
  theo quyết định hiện tại · `bỏ` không làm (kèm lý do).
- Thứ tự: theo đề xuất, trong mỗi nhóm theo phụ thuộc (dòng trên là tiền đề của dòng dưới).

### 2.1 MVP — lát 0 (L0)

| ID | Domain | Tính năng | Nguồn | APIs / reports | Role / restricted | Độ lớn | Đề xuất | Lý do | MVP? |
|---|---|---|---|---|---|---|---|---|---|
| PLT-01 | Nền tảng | Tenant, user, đăng nhập BFF (session httpOnly, token không tới browser), 5 role cố định theo seller account, mời user | LW §0/§13, LA §1.1, D55 | — | — | M | MVP·L0 | Mọi thứ khác cần tenant + RBAC; quy tắc tenancy CLAUDE.md | [ ] |
| PLT-03 | Kết nối | Kết nối tài khoản Ads: LWA auth-code → refresh token (mã hoá), liệt kê profile/advertiser account, chọn profile; xử lý "đã kết nối nhưng rỗng" | LA row 32, ADS §3.1 | v0 `listProfiles` (EX-PROFILES), v1 `QueryAdvertiserAccount`; LWA theo vùng NA/EU/FE | scope `advertising::campaign_management` | M | MVP·L0 | Cửa vào của mọi tính năng ads (D52) | [ ] |
| PLT-04 | Nền tảng | Chuyển seller account / marketplace; múi giờ, tiền tệ, giới hạn bid/budget theo marketplace **là dữ liệu** | LW §0/§14, ADS §2 (limits) | profile `countryCode/currencyCode/timezone`; bảng limits từ `concepts/limits.md` | — | S | MVP·L0 | Ngày "hôm nay", bounds bid/budget sai là lỗi ghi | [ ] |
| PLT-05 | Ingestion | Engine đồng bộ: lịch theo tenant, token bucket theo (seller account, operation), poll report, retry/backoff 429, last-sync marker (không full re-pull) | LA traps 10/15, SP cross-cutting, ADS §2 | Ads v1 `query*`, v1 reports; SP-API reports | — | L | MVP·L0 | Rate limit thấp + report bất đồng bộ là rủi ro kỹ thuật chính | [ ] |
| ADS-01 | Ads | Đồng bộ cấu trúc SP: campaign, ad group, product ad, target (keyword/product/auto, negative) | LA §1.2–1.4, row 1/5 | v1 `SPQueryCampaign/AdGroup/Ad/Target` (+`nextToken`); Exports `CampaignExport…GetExport` (EX-EXPORTS) cho đồng bộ toàn bộ 1–2 lần/ngày | ads scope | L | MVP·L0 | Nguồn dữ liệu cho mọi màn ads | [ ] |
| ADS-02 | Ads | Báo cáo hiệu quả theo ngày (campaign, ad group, target, ad; sau đó search term, placement): Spend, Sales, Orders, Units, Clicks, Impr, CTR, CPC, ACOS, ROAS, CR, CPM, CPO, AOV, TOS IS | LW §2 metrics, LA §1.8 row 2/6 | v1 `AdsApiv1CreateReport/RetrieveReport` (844 field), **không** dùng Reporting v3 (tắt 2027-06-30) | ads scope | L | MVP·L0 | Grid không có metric là vô dụng; concurrency report có thể = 1 | [ ] |
| ADS-03 | Ads | Campaign Manager: tab Campaigns / Ad groups / Product ads / Targets; KPI cards + chart; date preset + **compare**; filter, search, quick chips (hết budget, impr không click); chọn/ẩn/ghim cột; dòng Total; xuất CSV bảng. **L0 = chỉ đọc** | LW §2/§7, CON §2.1, LA §1.8 | đọc DB (ADS-01/02) | Viewer+ | L | MVP·L0 | Màn chính của console và ads-web | [ ] |
| PLT-07 | Ghi Amazon | Lớp ghi an toàn: batch, map lỗi 207 theo `index`, retry chỉ item lỗi, outbox + reconcile, ghi full record khi API là replace, kết quả từng dòng cho UI | LA trap 2/9, LW §0 write semantics, ADS §2 | v1 `SPUpdate*` (207); v0 `Prefer: return=representation` | Manager+ | M | MVP·L0 | Lỗi ghi im lặng là rủi ro tiền thật | [ ] |
| AUT-01 | Tự động | Rule engine lõi + **1 luật bid**: "nếu ACOS > X% trong N ngày và click ≥ M thì giảm bid target Y% (sàn Z)"; chạy theo lịch, dry-run/preview, duyệt (`preview+approve`) hoặc tự chạy trong giới hạn (`rule+cap`), audit, undo bằng batch ngược | LA §1.6/§1.7 row 12, F-01/F-02, D56 | đọc ADS-02; ghi v1 `SPUpdateTarget` (bid) | Manager tạo luật; chạy ghi log | L | MVP·L0 | Chốt lát mỏng (ANALYSIS rủi ro 4); legacy không có logic để chép | [ ] |
| PLT-06 | Nền tảng | Audit log mọi lần ghi qua seller-hub (ai, khi nào, trước→sau, kết quả từng item), trace id; màn History | LA §1.10, LW §10, CON §2.2 History | Ads `getHistory` (EX-CHANGE-HISTORY, SP/SB) để thấy thay đổi ngoài app | Analyst+ | M | MVP·L0 | Bắt buộc khi có luật tự ghi | [ ] |

### 2.2 MVP — phần còn lại

| ID | Domain | Tính năng | Nguồn | APIs / reports | Role / restricted | Độ lớn | Đề xuất | Lý do | MVP? |
|---|---|---|---|---|---|---|---|---|---|
| PLT-02 | Kết nối | Kết nối SP-API (self-authorization refresh token cho app private, D1 c), đọc marketplace tham gia, gắn với cùng seller account bên Ads | SP §1, reference-patterns 1.1/1.2 | `sellers.getMarketplaceParticipations` (0.016 rps, gọi 1 lần/ngày) | PL (hoặc bất kỳ role) | M | MVP | Cửa vào vận hành; nối Ads ↔ SP-API theo seller | [ ] |
| CAT-01 | Listing | Đồng bộ listing: report toàn bộ + trạng thái/issue từng SKU, làm giàu ASIN mới (tiêu đề, ảnh) | SP §2, LA row 21/22 | report `GET_MERCHANT_LISTINGS_ALL_DATA`; `listingsItems.searchListingsItems` (`includedData=summaries,issues`); `catalogItems.getCatalogItem` | PL | M | MVP | Lát vận hành đầu tiên (gợi ý D10) | [ ] |
| CAT-02 | Listing | Màn Listing: SKU, ASIN, tiêu đề/ảnh, trạng thái, issue, giá, số lượng FBA, đang chạy ads hay không | SP §2, LW §11 Products (bản generic) | đọc DB (CAT-01, INV-01, ADS-01) | Viewer+ | M | MVP | Màn đầu tiên nối listing + ads | [ ] |
| ADS-04 | Ads | Bulk actions có báo kết quả từng dòng: Enable/Pause/Archive; điều chỉnh budget (+$, +%, =$, −$, −%); điều chỉnh bid, áp bid gợi ý; chọn tối đa 300 (campaign)/100 (con), giữ khi đổi trang | LW §2, CON §2.1 bulk | v1 `SPUpdateCampaign/AdGroup/Ad/Target`; bid gợi ý EX-TARGETING-RECS | Manager+ | M | MVP | Parity lõi | [ ] |
| ADS-05 | Ads | Chi tiết campaign SP: settings (tên, ngày, budget, bidding strategy, portfolio), Ad groups, Placement bid adjustments (TOS/ROS/PP 0–900%), Negative targeting cấp campaign, tab Budget rules (đọc), History | LW §5, CON §2.2 | v1 `SPUpdateCampaign` (`optimizations.bidSettings`), v1 targets `negative=true` cấp campaign | Manager+ ghi | L | MVP | Parity lõi | [ ] |
| ADS-06 | Ads | Chi tiết ad group SP: settings (default bid), Ads (+thêm sản phẩm), Targeting (+thêm keyword/product), Negative targeting, archive có xác nhận | LW §6, CON §2.3 | v1 `SPCreate/UpdateAd`, `SPCreate/UpdateTarget`; suggestions EX-TARGETING-RECS | Manager+ ghi | L | MVP | Parity lõi | [ ] |
| ADS-07 | Ads | Search terms của ad group: bảng term + metric, cờ "đã là keyword/negative", hành động thêm làm keyword / negative / product (thủ công) | LW §7, LA §1.8, CON §2.3 | v1 report search term (**độ phủ field cần xác nhận**, §7 Q-D57); ghi v1 targets | Manager+ ghi | M | MVP | Công việc tối ưu hằng ngày; tiền đề harvest tự động | [ ] |
| ADS-08 | Ads | Tạo campaign SP (một trang như console): settings, portfolio, sản phẩm (tìm/dán/upload, báo lỗi từng ASIN/SKU), Auto (bid theo nhóm) / Manual keyword (gợi ý Broad/Phrase/Exact) / Manual product (category + ASIN), negatives, bidding strategy, placements; tạo cả cây campaign→ad group→ad→target; chống bấm 2 lần | LW §3, CON §1.2, LA §1.2 | v1 `SPCreateCampaign/AdGroup/Ad/Target`; EX-TARGETING-RECS (keyword/bid/product/category recs), EX-TARGETING-DISCOVERY (category tree, product counts, brand search) | Manager+ | XL | MVP | Parity lõi; nặng nhất của MVP ads | [ ] |
| ADS-09 | Ads | Portfolios: list, tạo, sửa budget cap (không / khoảng ngày / tháng lặp), chuyển/bỏ campaign khỏi portfolio, chi tiết portfolio với bảng campaign | LW §8, CON §2.4 | v0 `CreatePortfolios/UpdatePortfolios/ListPortfolios` (EX-PORTFOLIOS); v1 campaign `portfolioId` | Manager+ ghi | M | MVP | Parity lõi; cũng là đơn vị nhóm campaign | [ ] |
| INV-01 | Tồn kho | Đồng bộ tồn kho FBA (fulfillable, inbound, reserved, unfulfillable) + cột tồn kho trên Listing và Ads | SP §5, LA row 9 | `fbaInventory.getInventorySummaries` (2 rps, lọc theo ngày thay đổi) | AF (hoặc PL) | M | MVP | Nối tồn kho ↔ ads; tiền đề pause khi hết hàng | [ ] |
| ORD-01 | Bán hàng | Tổng quan doanh số theo ngày/tuần (marketplace, ASIN, SKU) + TACoS sơ bộ (ad spend / tổng doanh số) | SP §14, F-13 | `sales.getOrderMetrics` (0.5 rps) | PL hoặc IOT | S | MVP | Rẻ, không cần ingest đơn; cho TACoS ngay | [ ] |
| ORD-02 | Đơn hàng | Đồng bộ đơn hàng **không PII**: backfill bằng report, cập nhật theo last-updated; danh sách + chi tiết đơn (dòng hàng, trạng thái, kênh FBA/MFN) | SP §4, D11 | report `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL`; `orders@2026-01-01.searchOrders` (0.0056 rps) / `getOrder`; notification `ORDER_CHANGE` khi có PLT-11 | AF/IOT/PL; **không** role restricted | L | MVP | Gợi ý D10; rate limit buộc thiết kế report-first | [ ] |
| FIN-01 | Tài chính | Đồng bộ giao dịch tài chính (phí, charge, refund, ads charges) theo posted date; màn giao dịch + tổng phí theo SKU/tháng | SP §9 | `finances@2024-06-19.listTransactions` (0.5 rps); `listFinancialEventGroups` (v0) cho nhóm settlement | FA | M | MVP | Gợi ý D10; nền cho lợi nhuận v1 | [ ] |

### 2.3 v1 — ngay sau MVP

| ID | Domain | Tính năng | Nguồn | APIs / reports | Role / restricted | Độ lớn | Đề xuất | Lý do | MVP? |
|---|---|---|---|---|---|---|---|---|---|
| PLT-08 | Nền tảng | Thông báo in-app (chuông, SSE) + email + webhook Slack/Teams theo tenant: hết budget, cảnh báo tồn kho, kết quả chạy luật, lỗi đồng bộ | LW §13, LA §1.9 row 14/25 | — | — | M | v1 | Cần cho automation; MVP dùng History + màn kết quả | [ ] |
| PLT-09 | Nền tảng | Export center: xuất nền (xlsx/CSV) theo truy vấn bảng, lịch sử tải, link ký tên | LW §10, LA §1.10 row 23 | object store S3-compatible | Analyst+ | M | v1 | MVP đã có xuất CSV trong bảng | [ ] |
| PLT-10 | Nền tảng | Nhóm / tag seller account (thay "team/category" nội bộ), lọc và tổng hợp theo nhóm | LA row 4/28 | — | Admin | S | v1 | Seller nhiều tài khoản/marketplace | [ ] |
| PLT-11 | Ingestion | Nhận SP-API Notifications (SQS/EventBridge): ORDER_CHANGE, FBA_INVENTORY_AVAILABILITY_CHANGES, LISTINGS_ITEM_STATUS/ISSUES_CHANGE, REPORT_PROCESSING_FINISHED, ANY_OFFER_CHANGED | SP §11, reference-patterns 1.3 | `notifications.createDestination/createSubscription` | role theo loại notification | M | v1 | Cần AWS (R7, D21); MVP dùng poll + report | [ ] |
| PLT-12 | Ingestion | Amazon Marketing Stream **v2** (Parquet → S3 + SQS, hourly, 15 phút): `ads-performance-v1`, `ads-converted-product-v1` | ADS §3.11, LA row 7 | v1 `AdsApiv1CreateStreamSubscription…` | ads scope | L | v1 | Độ tươi theo giờ (thay "real-time mode" legacy); cần AWS; loại account được hỗ trợ chưa rõ (Q-D58) | [ ] |
| ADS-10 | Ads | Budgets: đề xuất budget của Amazon (thời gian trong budget, doanh số/impr/click bỏ lỡ) + áp dụng; nhật ký hết budget (OOB) | LW §9, CON §2.4 Budgets, LA §1.5c | `getBudgetRecommendations`, `spCampaignsBudgetUsage`, `portfolioBudgetUsage` (EX-BUDGET-USAGE-RECS, EX-PORTFOLIOS) | Manager+ áp dụng | M | v1 | Có giá trị cao; Stream v1 `budget-usage` chết 2027-06 → phải poll | [ ] |
| ADS-11 | Ads | Budget rules của Amazon (lịch / theo hiệu quả), gán/bỏ gán campaign, danh sách Rules | LW §9, CON §2.4 Rules, LA §1.5a | SP/SB/SD budget rules (EX-BUDGET-RULES, 26 ops) | Manager+ | M | v1 | Parity console; toàn bộ v0 | [ ] |
| ADS-12 | Ads | Sponsored Brands: builder (3 goal, format Collection/Store spotlight/Video, creative, brand/logo, cost control), chi tiết campaign/ad group SB, creative + kiểm duyệt | LW §4/§5/§6, CON §1.3/§2.2/§2.3 | v1 `SB*` CRUD; EX-BRAND-ASSETS (asset library, stores, pageAsins), EX-MODERATION, v1 `QueryBrandStore*`; Product Collection lỗi từ 01/2027 | Manager+ | XL | v1 | Cần Brand Registry; console đầy đủ nhất ở SB | [ ] |
| ADS-13 | Ads | Sponsored Display: builder (tactic contextual / audiences, bid optimization, creative ảnh/video), chi tiết, preview + kiểm duyệt creative | LW §4/§5/§6, CON §1.4 | v1 `SD*` CRUD; EX-TARGETING-DISCOVERY (audience taxonomy), EX-BRAND-ASSETS, EX-MODERATION, EX-BRAND-SAFETY | Manager+ | XL | v1 | Ít dùng hơn SP; nhiều ngoại lệ v0 | [ ] |
| ADS-14 | Ads | Copy campaign (cùng profile; sang profile/marketplace khác — không copy budget rule/creative) | LW §2, LA §1.2 | v1 `SPQuery*` → `SPCreate*` | Manager+ | M | v1 | Amazon không có API copy; tiện cho đa marketplace | [ ] |
| ADS-15 | Ads | Drafts: lưu nháp campaign trong seller-hub, xem lại, launch | CON §1.2/§1.3 | lưu DB; launch như ADS-08 | Manager+ | S | v1 | Console có, ads-web không | [ ] |
| ADS-16 | Ads | Hộp đề xuất: recommendations của Amazon + đề xuất của luật seller-hub, chấp nhận = ghi có duyệt | F-10, CON §3 Recommendations | v1 `QueryRecommendation` (4 type), `getCampaignRecommendations` (EX-TARGETING-RECS) | Manager+ | M | v1 | Ra quyết định một chỗ | [ ] |
| ADS-17 | Ads | "Cần chú ý" (home): campaign sắp/hết budget, target ACOS tăng ≥ 15 điểm 7 ngày, ASIN quảng cáo hết hàng, product ad không đủ điều kiện | LW §1 (bản generic), LA §1.3 | đọc DB (ADS-02, INV-01); eligibility từ v1 ad status | Viewer+ | M | v1 | Màn home legacy, bỏ phần ticket/BI | [ ] |
| ADS-18 | Ads | Trang sản phẩm (ASIN): ads theo ASIN, eligibility, tồn kho, xu hướng; thêm vào campaign có sẵn; tắt ads của ASIN | LW §11 Products, CON §2.4 Products | v1 `SPCreateAd`/`SPUpdateAd`; `productEligibility` (EX-ELIGIBILITY) | Manager+ ghi | M | v1 | Nối listing ↔ ads theo sản phẩm | [ ] |
| ADS-19 | Ads | Report center: tạo báo cáo ads tuỳ chọn (>90 ngày, cột tuỳ chọn), tải file | LW §10 Reports, CON §2.1 "Create report" | v1 reports | Analyst+ | S | v1 | Dùng lại ADS-02 | [ ] |
| ADS-20 | Ads | Ads cho **vendor profile** (cùng màn SP/SB/SD; định danh `asin` thay `sku`, giới hạn budget vendor) | ADS §6, F-32 | cùng v1 ops; profile `type=vendor` | như ads | S | v1 | Specs cho thấy cùng API (cần xác nhận với tài khoản thật, Q-D60) | [ ] |
| AUT-02 | Tự động | Bộ luật bid theo mục tiêu (target ACOS / ROAS / CVR), floor/ceiling, % đổi tối đa/ngày | F-01, LA §1.7 auto bidding | như AUT-01 | Manager | M | v1 | Mở rộng AUT-01 | [ ] |
| AUT-03 | Tự động | Harvest keyword: search term chuyển đổi tốt → exact keyword (ngưỡng, bid đầu, chặn trùng, giới hạn/ngày) | F-05, LA §1.7 good terms | v1 report search term; v1 `SPCreateTarget` | Manager | M | v1 | Benchmark D56; preview+approve mặc định | [ ] |
| AUT-04 | Tự động | Negative tự động: term tốn click/spend không đơn → negative exact/phrase hoặc negative product; gỡ khi tốt lại | F-06, LA §1.7 bad terms | v1 targets `negative=true` | Manager | M | v1 | Benchmark D56 | [ ] |
| AUT-05 | Tự động | Pacing budget: theo dõi chi tiêu vs mục tiêu tháng (cap do user nhập), chuyển budget giữa campaign trong giới hạn; tự nạp khi hết budget sớm (cap, giới hạn/ngày, undo) | F-04, LA §1.5c/§1.5d row 28 | v1 `SPUpdateCampaign` budgets; EX-BUDGET-USAGE-RECS | Manager | M | v1 | Benchmark D56; thay "budget account" nội bộ | [ ] |
| AUT-06 | Tự động | Pause ads khi tồn kho dưới ngưỡng, resume khi có hàng lại (resume cần duyệt nếu muốn) | F-11, LA §1.7 inventory auto-stop row 11 | INV-01 (+ notification PLT-11); v1 `SPUpdateAd` state | Manager | M | v1 | Benchmark D56; legacy chỉ pause, không resume | [ ] |
| AUT-07 | Tự động | Dayparting: lịch bid / % placement theo giờ trong tuần (múi giờ marketplace), khôi phục giá trị gốc ngoài khung | F-03, LA §1.6 bidding rule | dữ liệu giờ từ PLT-12 (Stream v2); ghi v1 targets / campaign `bidAdjustments` | Manager | L | v1 | Benchmark D56; cần Stream v2 | [ ] |
| AUT-08 | Tự động | Takeover campaign có sẵn: chọn campaign đưa vào automation, mặc định tắt mọi luật, xem trước thay đổi | F-08 | v1 query | Manager | S | v1 | An toàn khi bật automation | [ ] |
| AUT-09 | Tự động | Bulk edit dạng bảng có diff + rollback batch | F-09 | như ADS-04 | Manager | M | v1 | Mở rộng ADS-04 | [ ] |
| INV-02 | Tồn kho | Days of cover, gợi ý lượng/ ngày đặt hàng lại, inbound có kịp không | F-14/F-24, LA row 9 (DOC) | `getInventorySummaries`, `sales.getOrderMetrics`, `fulfillmentInbound.listInboundPlans` | AF, PL | M | v1 | Join tồn kho + bán hàng (D56) | [ ] |
| INV-03 | Tồn kho | Cảnh báo rủi ro tồn kho cho ASIN đang quảng cáo (mức, ngưỡng theo tenant) | LW §11 Inventory alert (generic), LA §1.9 row 11 | INV-01, notification `FBA_INVENTORY_AVAILABILITY_CHANGES` | AF | M | v1 | Thay engine cảnh báo nội bộ | [ ] |
| ORD-03 | Bán hàng | Sales & Traffic theo ASIN (sessions, page views, conversion), tách doanh số do ads vs tự nhiên | F-13, LA row 9 | report `GET_SALES_AND_TRAFFIC_REPORT` hoặc Data Kiosk `salesAndTraffic` | **BA** (cần Brand Registry) | M | v1 | Cần role BA; benchmark D56 | [ ] |
| FIN-02 | Tài chính | Nhập COGS / chi phí khác theo SKU (người dùng nhập, có hiệu lực theo ngày) | LA row 9/22 | — | Admin/Manager | S | v1 | Amazon không có COGS | [ ] |
| FIN-03 | Tài chính | Lợi nhuận & TACoS ròng theo SKU/ASIN (doanh số − phí Amazon − ads − COGS), dùng làm mục tiêu cho luật | F-12 | FIN-01, ADS-02, FIN-02; Data Kiosk `economics` (BA) | FA (+BA tuỳ chọn) | L | v1 | Khác biệt lớn so với console; benchmark D56 | [ ] |
| FIN-04 | Tài chính | Đối soát settlement / payout cuối tháng, xuất cho kế toán (chỉ đọc) | F-25 | report `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2`, `GET_LEDGER_SUMMARY_VIEW_DATA`; `transfers.listPayouts` | FA (ledger: AF) | L | v1 | Không bao giờ chuyển tiền | [ ] |
| CAT-03 | Listing | Xử lý issue listing: giải thích, xem trước sửa (`VALIDATION_PREVIEW`), áp dụng sau khi duyệt | F-18/F-19, TK listing-issues | `searchListingsItems`, `patchListingsItem`, `productTypeDefinitions.getDefinitionsProductType` | PL | L | v1 | Listing bị chặn = mất doanh số | [ ] |
| AI-01 | AI | Trợ lý AI làm **client của Amazon Ads MCP**: hỏi đáp, tạo report, đề xuất thay đổi; mọi tool ghi phải người duyệt; context **FIXED** theo seller account (header do code đặt), allow-list tool | D50 a, ads-mcp §2/§5/§6, F-15/F-17 | `advertising-ai.amazon.com/mcp` (hoặc `/mcp/lite`) | ads scope; Manager duyệt ghi | L | v1 | D50: sau MVP; MCP không dùng cho ingestion | [ ] |
| AI-02 | AI | Thêm SP-API MCP (`sellingpartner-ai.amazon.com/mcp`) vào trợ lý: hỏi doanh số, tồn kho, listing | D50 a, ads-mcp §7, F-15 | SP-API MCP connector (tool connector-only không phải SP-API public — không dựa vào cho tính năng màn hình) | role SP-API tương ứng | M | v1 | Hoàn tất D50 a | [ ] |
| VEN-01 | Vendor | Kết nối vendor account (SP-API vendor), gắn vendor code / marketplace | SP §V, VC | LWA; vendor roles | AF, IOT, BA | S | v1 (ứng viên MVP) | D5: seller trước; tiền đề mọi VEN-* | [ ] |
| VEN-02 | Vendor | Purchase orders: đồng bộ theo cửa sổ created/changed, list (Unconfirmed/Confirmed/Closed), chi tiết, xác nhận (acknowledge) có duyệt; cảnh báo hạn huỷ | VC §2.1, F-29 | `vendorOrders.getPurchaseOrders/getPurchaseOrder/getPurchaseOrdersStatus/submitAcknowledgement`; `vendorTransactionStatus.getTransaction` | AF, IOT | M | v1 (ứng viên MVP) | API đầy đủ; chứng từ pháp lý → preview+approve | [ ] |
| VEN-03 | Vendor | Shipments / ASN: tạo và gửi ASN, xác nhận shipment, lấy nhãn vận chuyển, theo dõi trạng thái giao dịch | VC §2.2, F-29 | `vendorShipments.SubmitShipments/SubmitShipmentConfirmations/GetShipmentDetails/GetShipmentLabels`; `getTransaction` | AF | L | v1 (ứng viên MVP) | Appointments, ASN defects là console-only | [ ] |
| VEN-04 | Vendor | Gửi invoice (non-DF) có duyệt, theo dõi trạng thái | VC §2.8, F-29 | `vendorInvoices.submitInvoices`; `getTransaction` | AF, IOT | M | v1 (ứng viên MVP) | Không có API đọc payment | [ ] |
| VEN-05 | Vendor | Retail Analytics: sales, inventory, traffic, forecast, net PPM theo ASIN/kỳ, so kỳ trước | VC §2.7, F-13 | reports `GET_VENDOR_SALES_REPORT`, `GET_VENDOR_INVENTORY_REPORT`, `GET_VENDOR_TRAFFIC_REPORT`, `GET_VENDOR_FORECASTING_REPORT`, `GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT`, real-time; Data Kiosk `vendorAnalytics` | **BA** | M | v1 (ứng viên MVP) | API đầy đủ, chỉ đọc | [ ] |
| VEN-06 | Vendor | Catalogue vendor (xem ASIN, tiêu đề, ảnh; cost/availability là dữ liệu console) | VC §2.5 | `catalogItems.searchCatalogItems/getCatalogItem` | PL | S | v1 | Đọc là đủ cho join với ads | [ ] |

### 2.4 Sau (roadmap)

| ID | Domain | Tính năng | Nguồn | APIs / reports | Role / restricted | Độ lớn | Đề xuất | Lý do | MVP? |
|---|---|---|---|---|---|---|---|---|---|
| PLT-13 | Nền tảng | Thông báo hệ thống / banner sự cố theo account, ưu tiên, khung giờ | LW §13 Notification management | — | Admin | S | sau | Hữu ích khi SaaS nhiều tenant | [ ] |
| PLT-14 | Nền tảng | SaaS công khai: OAuth website authorization (SP-API public app), Ads consent cho tenant ngoài, audit DPP | D1 b, reference-patterns 1.1/1.2 | SP-API OAuth (`spapi_oauth_code`), LWA | app public | L | sau | D1 c: sau P6-SEC | [ ] |
| PLT-15 | Nền tảng | Quyền theo portfolio (user chỉ thấy/sửa portfolio được giao) | LW §8 settings, LA §1.1 | `portfolioId` | — | M | sau | D55 chọn role cố định theo seller account; cần đổi D55 | [ ] |
| ADS-21 | Ads | Bulk operations bằng spreadsheet (tải/đẩy file campaign), lịch sử job | CON §2.4 | v1 CRUD + Exports | Manager+ | L | sau | Console có, ads-web không | [ ] |
| ADS-22 | Ads | Optimization rules của Amazon (rule-based bidding phía Amazon) | LA §1.6, ADS §3.8 | EX-OPTIMIZATION-RULES (22 ops); bỏ liên kết: không có API public (LA row 31) | Manager+ | M | sau | Trùng mục tiêu với AUT-*; thiếu API gỡ | [ ] |
| ADS-23 | Ads | Builder nâng cao của console: Forecast, Targeting with AI, SP video + video bid adjustment, audiences (beta), SP Global (nhiều quốc gia), Amazon Business site, rule template trong builder | CON §1.2, CON parity | v1 `SPGlobal*`, `SPAudienceBidAdjustment`, `SPCreativeBidAdjustment`, `SPCreateAdExtension` | Manager+ | L | sau | Ngoài lõi; nhiều mục beta | [ ] |
| ADS-24 | Ads | Billing / invoice quảng cáo (chỉ đọc) | CON §3, ads-mcp §5 | EX-BILLING (21 ops) hoặc MCP `billing` | Admin | S | sau | Không thuộc quản lý quảng cáo lõi | [ ] |
| ADS-25 | Ads | Brand metrics, brand analytics (ads), Stores insights | CON §3, ADS §3.10 | EX-BRAND-ANALYTICS | Analyst | M | sau | Brand-only | [ ] |
| AUT-10 | Tự động | Tạo campaign từ ASIN + mục tiêu (cấu trúc auto/manual/exact/brand defense, luôn là nháp) | F-07, LA §1.7 auto campaign creation | v1 create; catalog/listings | Manager | L | sau | Cần ADS-08 + AUT ổn định | [ ] |
| AI-03 | AI | Chẩn đoán doanh số giảm (listing, hết hàng, buy box, ads) | F-16, TK sp-sales-drop | `getOrderMetrics`, `searchListingsItems`, `getInventorySummaries`, `getCompetitiveSummary`, v1 reports | — | M | sau | Cần đủ dữ liệu vận hành | [ ] |
| AI-04 | AI | MCP server riêng của seller-hub (ads + tồn kho + tài chính + lợi nhuận) cho Claude/ChatGPT | D50 b, ads-mcp §6 | dữ liệu DB seller-hub | theo D55 | L | sau | D50: sau AI-01 | [ ] |
| AI-05 | AI | Dịch keyword/search term (LLM) — opt-in theo tenant, key riêng | LA row 26, trap 17 | nhà cung cấp LLM do tenant chọn | — | S | sau | Legacy gửi keyword cho LLM không có đồng ý | [ ] |
| AI-06 | AI | Trợ giúp tạo support case (tóm tắt không PII, người dùng tự gửi) | F-27 | `support.listCases/getCase` | **SPS\*** (restricted) | S | sau | Role restricted | [ ] |
| CAT-04 | Listing | Buyability / searchability review, đề xuất nội dung có duyệt | F-20/F-21 | `searchListingsItems`, `patchListingsItem` | PL | M | sau | Sau CAT-03 | [ ] |
| CAT-05 | Listing | Compliance gate trước khi ghi listing bị hạn chế | F-22 | `listingsRestrictions.getListingsRestrictions` | PL | S | sau | Tư vấn, không chặn MVP | [ ] |
| CAT-06 | Listing | A+ content (Standard/Premium/Brand Story): tìm ASIN thiếu A+, tạo/sửa, gắn ASIN, gửi duyệt | F-31 | `aplusContent.*`, `uploads.createUploadDestinationForResource` | BA, PL; Brand Registry | L | sau | Seller + vendor; brand-only | [ ] |
| CAT-07 | Listing | Sửa listing hàng loạt qua JSON listings feed | SP §13 | `feeds.createFeedDocument/createFeed` (0.0083 rps) | PL | M | sau | Sau CAT-03 | [ ] |
| INV-04 | Tồn kho | Báo cáo kế hoạch tồn kho: aged, stranded, restock, reimbursements | SP §5 | `GET_FBA_INVENTORY_PLANNING_DATA`, `GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT`, `GET_STRANDED_INVENTORY_UI_DATA`, `GET_FBA_REIMBURSEMENTS_DATA` | AF | M | sau | Bổ sung INV-02 | [ ] |
| INV-05 | Tồn kho | FBA inbound plan (create → pack → place → transport → confirm), mỗi bước duyệt | F-23 | `fulfillmentInbound@2024-03-20` (45 ops) | AF | XL | sau | Ghi có phí, quy trình dài | [ ] |
| INV-06 | Tồn kho | AWD inventory / inbound | SP §6 | `awd.listInventory/listInboundShipments` | AWD | S | sau | Chỉ seller dùng AWD | [ ] |
| INV-07 | Fulfillment | Multi-channel fulfillment (MCF) đơn ngoài Amazon | SP §7 | `fulfillmentOutbound@2026-07-04` (roles chưa công bố) | unknown; địa chỉ = dữ liệu cá nhân | M | sau | Có dữ liệu cá nhân dù không RDT | [ ] |
| ORD-04 | Đơn hàng | Messaging / request review (solicitations) theo đơn, theo cửa sổ hợp lệ | SP §12 | `solicitations.*`, `messaging@v1` | BS, BC | M | sau | Không thuộc lõi | [ ] |
| ORD-05 | Đơn hàng | Review topics / phản hồi khách theo ASIN | SP §12 | `customerFeedback@2024-06-01` | BA, SPI | S | sau | Phân tích | [ ] |
| FIN-05 | Tài chính | Ước tính phí theo giá (fee calculator) | SP §3 | `productFees.getMyFeesEstimates` | PR, PL | S | sau | Phí thực lấy từ FIN-01 | [ ] |
| PRC-01 | Giá | Theo dõi buy box / giá cạnh tranh theo sự kiện | SP §3, F-16 | `ANY_OFFER_CHANGED`, `PRICING_HEALTH`; `getCompetitiveSummary` (0.033 rps) | PR | M | sau | Rate limit rất thấp → chỉ theo sự kiện | [ ] |
| PRC-02 | Giá | Tự động đổi giá / pricing rules | P-03, Postman pricing | listings patch / feeds | PR | L | sau | Cần quyết định sản phẩm (guardrail toolkit cấm tư vấn giá) | [ ] |
| PRC-03 | Giá | Xem promotions của seller | SP §3 | `promotions@2025-12-01.searchPromotions/getPromotion` (0.1 rps) | PR, PL | S | sau | API mới, chỉ đọc | [ ] |
| VEN-07 | Vendor | Promotions / deals / price discount / coupons của vendor: **chỉ đọc hoặc nhập tay**, link sang Vendor Central | VC §1, §2.6 | **không có API** (console-only); xác nhận `promotions@2025-12-01` có trả promo vendor không (Q-D61) | — | M | sau | Không có API ghi; không scrape console | [ ] |
| VEN-08 | Vendor | Sales + tồn kho + ads cho vendor theo ASIN; pause ads khi thiếu hàng | F-30 | VEN-05 + ADS-20 | BA | M | sau | Cần VEN-05 và ADS-20 | [ ] |
| OTH-01 | Khác | Subscribe & Save (replenishment), action items/plans, app integrations vào Seller Central | SP §14, §1 | `replenishment@2022-11-07`, `actionItems/actionPlans@2026-06-01`, `appIntegrations@2024-04-01` | SPI, NSC | M | sau | Nhu cầu chưa rõ | [ ] |

### 2.5 Ngoài phạm vi / bỏ

| ID | Domain | Tính năng | Nguồn | APIs / reports | Role / restricted | Độ lớn | Đề xuất | Lý do | MVP? |
|---|---|---|---|---|---|---|---|---|---|
| ORD-06 | Đơn hàng | PII người mua (tên, địa chỉ, phone, email), RDT, bảng mã hoá riêng | SP §4, D11 | `tokens.createRestrictedDataToken`, `orders@v0.getOrderAddress/getOrderBuyerInfo…` | **DTC\*, TI\*, TR\*** | L | ngoài | D11 mặc định không; client vẫn có lớp RDT để từ chối gọi | [ ] |
| ORD-07 | Đơn hàng | Nhãn vận chuyển MFN / Buy Shipping / Easy Ship | SP §8 | `merchantFulfillment@v0`, `shipping@v2`, `easyShip` (RDT) | DTC\* | L | ngoài | PII + role restricted | [ ] |
| VEN-09 | Vendor | Direct Fulfillment (đơn, nhãn, packing slip, tồn kho DF, invoice DF) | VC §2.4, SP §V | `vendorDirectFulfillment*` | **DTC\*** (RDT) | L | ngoài | D5/D11: DF ngoài trừ khi D11 đổi | [ ] |
| VEN-10 | Vendor | Born to Run, Supply Chain, Vine, VoC, ảnh/video/chứng chỉ sản phẩm | VC §2.3, §2.5, §2.8 | không có API | — | — | bỏ | Console-only | [ ] |
| FIN-06 | Tài chính | Chuyển tiền / payout / wallet / hoá đơn thuế | SP §9 | `transfers.initiatePayout`, `sellerWallet`, `invoices`, `shipmentInvoicing` | FA, AISP/PISP (EU), TI\* | — | ngoài | Di chuyển tiền + quy định; cấm theo quy tắc an toàn | [ ] |
| ADS-26 | Ads | Streaming TV, DSP, AMC, Attribution, Amazon Live, Brand lift, Creative Studio, Ads planner | CON §1.5/§3, ADS §3.14, ads-mcp §5 | 482 v0 + 77 v1 ops out-of-scope; Amazon Live chỉ có MCP | — | — | ngoài | D2: sponsored ads seller/vendor; P-01 parked | [ ] |
| OTH-02 | Khác | Services (Home Services), vehicles (fitment) | SP §14 | `services@v1`, `vehicles@2024-11-01` | PS\* | — | ngoài | Ngành dọc, role restricted | [ ] |
| OTH-03 | Khác | Kênh ngoài Amazon (Walmart, Wayfair, Google, Meta) | LW §11/§13, P-02 | — | — | — | ngoài | D2 | [ ] |
| OTH-04 | Khác | Đọc dữ liệu console bằng cookie người dùng / endpoint riêng của console ("real-time mode") | LA §0 fact 2, row 2/3, trap 1 | — | — | — | bỏ | Vi phạm điều khoản Amazon, gãy khi console đổi; thay bằng ADS-02 + PLT-12 | [ ] |
| OTH-05 | Khác | Công cụ dev: SP-API knowledge assistant | F-28 | — | — | — | bỏ (khỏi sản phẩm) | Dùng khi thiết kế, không phải tính năng | [ ] |

---

## 3. Đối chiếu legacy

Nguồn: `catalog/legacy/web-features.json` (26 màn), `web-non-feature-routes.json` (12 route),
`api-endpoints.json` (212 external + 39 internal route, gom theo đoạn path đầu), `jobs.json` (25).
"bỏ (internal)" = khái niệm riêng của công ty cũ, không có ý nghĩa với seller khác (D0); tên nội bộ không ghi.

### 3.1 Màn hình ads-web → feature

| Màn legacy (route) | Feature seller-hub | Ghi chú |
|---|---|---|
| Home / issue dashboard (`/`) | ADS-17 | Thẻ ticket + tab BI nhúng: **bỏ (internal)** — hệ ticket và BI của công ty cũ |
| Sponsored Ads manager (`/campaign`, `/campaigns/*`) | ADS-03, ADS-04, ADS-14 (copy), PLT-09 (export nền) | Nút tạo campaign → ADS-08/12/13 |
| Create SP campaign (`/campaign/create*`) | ADS-08 | Gom thành một trang như console |
| Create SB campaign | ADS-12 | |
| Create SD campaign | ADS-13 | |
| Campaign detail (SP/SB/SD) | ADS-05 (SP), ADS-12, ADS-13; tab Budget rules → ADS-11; tab History → PLT-06 | |
| Ad group detail | ADS-06, ADS-07 (search terms); SB creative → ADS-12; SD creative → ADS-13 | |
| Create ad group (SB, SD) | ADS-12, ADS-13 (SP: ADS-06) | |
| Targeting listing (`/targeting`) | ADS-03 (tab Targets), ADS-04 | Dòng dịch keyword → AI-05 |
| Budget recommendation | ADS-10 | |
| Rules management (`/rules`) | ADS-11 (budget rules Amazon); bid rules → AUT-01/AUT-02 | Bid rule legacy là automation phía app |
| Legacy rule pages v1 (`/rules/[id]`, `/budget-rule`, `/rule-campaign`) | ADS-11 | Bản cũ đã bị `/rules` thay; không làm riêng |
| Portfolio management (list) | ADS-09 | |
| Portfolio detail | ADS-09 | |
| Portfolio settings (users, permissions, history) | PLT-15 (sau), PLT-06 | RBAC theo portfolio: chờ đổi D55 |
| History (`/history`) | PLT-06 | Tab "Log Request Action" (kết quả copy hàng loạt) → PLT-06 + ADS-14 |
| Reports (`/reports`) | ADS-19 | |
| Notification management + bell + banner | PLT-08 (chuông), PLT-13 (banner) | Bus thông báo nội bộ: thay bằng bảng + SSE |
| Inventory alert | INV-03, AUT-06 | Engine cảnh báo + "Action on ASIN" + feedback: **bỏ (internal)** — mô hình riêng; bản generic là ngưỡng do tenant đặt |
| Products (`/products`) | ADS-18, CAT-02 | Cột kho/real sale/GMV: **bỏ (internal)** — dữ liệu kho riêng; DOC → INV-02, TACoS → ORD-01/FIN-03 |
| Product issue tickets | — **bỏ (internal)** | Hệ ticket công ty; không phải năng lực Amazon (LA row 20) |
| Budget account requests | — **bỏ (internal)**; ý generic → AUT-05 (cap tháng do user nhập) | Quy trình duyệt tài chính nội bộ |
| Spend / performance dashboard | ADS-03 (KPI + chart), PLT-10 (theo nhóm) | Chiều "team": **bỏ (internal)**; Walmart/Wayfair → OTH-03 |
| User management | PLT-01 | Phòng ban, module-admin: **bỏ (internal)** (D55 role cố định) |
| Real-time mode (`/amazon/*`) | ADS-02 + PLT-12 (độ tươi), ADS-10 (OOB) | Chạy trên endpoint riêng của console bằng cookie → OTH-04 **bỏ** |
| In-app docs viewer (`/docs`) | — **bỏ (internal)** | Tài liệu dev nội bộ |
| Non-feature: `/403`, `/404`, ErrorBoundary, `_app`, `_document` | PLT-01 (shell, P3-DS) | Hạ tầng UI |
| Non-feature: `/api/auth/*`, `/api/backend/*`, `/api/me/*` | PLT-01 (BFF) | Giữ mẫu BFF; bỏ IdP/portal nội bộ |
| Non-feature: `/api/portal/*` | — **bỏ (internal)** | Portal công ty |
| Non-feature: `/api/export/*` | PLT-09 | |
| Non-feature: `/api/notifications/ws-url` | PLT-08 | |
| Non-feature: `/api/internal/healthcheck` | hạ tầng (health check) | |
| Non-feature: `/api/dev/curl-context` | — **bỏ** | Công cụ dev |

### 3.2 Nhóm endpoint ads-api → feature

External (212 route):

| Nhóm (`/api/external/…`) | Số route | Feature | Ghi chú |
|---|---|---|---|
| `campaigns` — list, get, create, update, delete, update-state, update-multiple, update-adjust-budget | 30 (cả nhóm) | ADS-01, ADS-03, ADS-04, ADS-05, ADS-08 | |
| `campaigns/clone`, `clone-from-profile` | ↑ | ADS-14 | |
| `campaigns/stores`, `page-asins*` | ↑ | ADS-12 | v1 `QueryBrandStore*` + EX-BRAND-ASSETS |
| `campaigns/get-campaign-placement*` (kể cả Amazon Business) | ↑ | ADS-05 | Placement B2B chưa có nguồn (Q-D57) |
| `campaigns/recommend`, `get-log-campaigns-oob`, `runtime` | ↑ | ADS-10 | |
| `campaigns/amz-*` (real-time) | ↑ | OTH-04 **bỏ** → ADS-02/PLT-12 | Endpoint riêng của console |
| `campaigns/:id/optimization-rules` | ↑ | ADS-22 | |
| `campaigns/:id/bidding-rules*` | ↑ | AUT-07 (lịch placement), AUT-01 | |
| `campaigns/get-by-aws-id` | ↑ | ADS-01 | Legacy không xác thực → phải có auth |
| `ad-group` | 13 | ADS-06, ADS-03, ADS-12/13 (`verify-store-spotlight`), ADS-14 (`clone`); `amz-adgroup-list` **bỏ** (OTH-04) | |
| `product-ads` | 9 | ADS-06, ADS-04, ADS-12 (`update-creative`), ADS-12/13 (`get-moderation-results`, EX-MODERATION); `amz-product-ad` **bỏ** | |
| `keyword`, `target` | 5 + 10 | ADS-06, ADS-03, ADS-04, ADS-08 (recommend, product-count); `amz-target-in-campaign` **bỏ** | v1 targets gộp keyword |
| `negative-keyword`, `negative-target`, `campaign-negative-keywords`, `campaign-negative-products` | 5+7+3+3 | ADS-05, ADS-06 | v1 `negative=true` |
| `sb/negative-target` (brand search/recommend), `category`, `audience` | 2+3+5 | ADS-08, ADS-13 | EX-TARGETING-DISCOVERY |
| `sb/recommendations`, `sd/target` | 5+4 | ADS-12, ADS-13 | EX-TARGETING-RECS |
| `sb/creatives`, `sd/creatives`, `sd/assets`, `sd/:id/creatives`, `sd/moderation` | 6+5+4+1+1 | ADS-12, ADS-13 | EX-BRAND-ASSETS, EX-MODERATION |
| `sb/campaigns/:id/optimization-rules` | 1 | ADS-22 | |
| `portfolio` — list, list-for-filter, create, update, get | 9 (cả nhóm) | ADS-09 | |
| `portfolio/operations*` (users, suffix-emails) | ↑ | PLT-15 (sau) | Phân quyền theo portfolio của công ty cũ |
| `budgets`, `rules` | 15+7 | ADS-11 (budget rules), AUT-01/02 (`bidding-rule`), ADS-10 (`recomment`, `all-recommendation`) | `budgets/run-job`, `get-total-by-profile`: **bỏ (internal)** — job ngân sách nội bộ |
| `budget-recommendations` (list, approve, reasons) | 3 | AUT-05 | Feed từ mô hình nội bộ: **bỏ (internal)**; ý "duyệt đề xuất" giữ |
| `search-terms` | 3 | ADS-07; `amz-search-term` **bỏ** (OTH-04) | Impression share/rank qua report v1 (Q-D57) |
| `product` (metadata, list, inventory) | 4 | ADS-18, CAT-02, INV-01 | |
| `competitor-target-products` | 1 | — **bỏ (internal)**; thay bằng product recommendations (ADS-08) | Bảng dữ liệu công ty |
| `report` (spend, by date, performance) | 4 | ADS-03, PLT-10 | |
| `inventory-alerts`, `inventory-alert-feedback` | 1+2 | INV-03 | Feedback theo alert: **bỏ (internal)** |
| `notification` | 3 | PLT-08, PLT-13 | |
| `user-log`, `operation-log`, `log-request-action` | 3+2+1 | PLT-06 | |
| `download-histories` | 5 | PLT-09 | |
| `profile` (list) | 4 | PLT-03, PLT-04 | `get-profile-wrong`, `test-profile`, `call-profile`: **bỏ** — debug còn sót (LA trap 6) |
| `role` | 6 | PLT-01 | `module-admin`, `profile-admin`, `assign-portfolios-role`: **bỏ (internal)** |
| `configs`, `filter`, `breadscrumb` | 2+1+1 | PLT-04, ADS-03 (cấu hình lọc/cột), shell | |
| `ticket-management` | 7 | — **bỏ (internal)** | Hệ ticket công ty |
| `read-db` (cache get/del/keys) | 4 | — **bỏ** | Lộ Redis qua HTTP (LA trap 4) |
| `health-check` (info, check-file) | 2 | hạ tầng; `check-file` **bỏ** (debug) | |

Internal (39 route):

| Nhóm (`/api/internal/…`) | Số route | Feature | Ghi chú |
|---|---|---|---|
| `migrate/*` (đồng bộ toàn bộ, trigger automation) | 18 | PLT-05 (job trong worker, không mở HTTP) | Full re-pull → đồng bộ tăng dần (LA trap 10) |
| `campaigns/bidding-rules/cron`, `clone-*-multiple` | 3 | AUT-07 / AUT-01 (scheduler), ADS-14, AUT-10 | |
| `auto/campaign-budgets` | 1 | AUT-05 | |
| `budget-profile` | 2 | — **bỏ (internal)** | Ngân sách duyệt theo phòng ban |
| `api-interface/call`, `backup-cookie` | 2 | — **bỏ** | Proxy mở (SSRF) + cookie console (LA trap 4, row 3) |
| `read-db` (cache, rundb, migrate) | 7 | — **bỏ** | Runner SQL / Redis không xác thực |
| `portfolio/operations/migrate-users`, `profile/get-profile-cate-detail` | 1+1 | — **bỏ (internal)** | Đồng bộ user portal, CSV team |
| `health-check` | 2 | hạ tầng | |
| `test/*` | 2 | — **bỏ** | Debug |

### 3.3 Job / consumer ads-api → feature

| Job legacy | Feature | Ghi chú |
|---|---|---|
| `migrate-job`, `migrate-campaign-job`, `migrate-change-status-asin-product-ads-job` | PLT-05, ADS-01 | Thay bằng v1 query tăng dần + Exports |
| `cron-bidding-rule` | AUT-07 / AUT-01 | |
| `auto-bidding-job`, consumer `target_bid` | AUT-02 | Mô hình quyết định không có → tự thiết kế |
| `auto-campaign-job`, `budget_campaign` | AUT-05 | |
| `auto-create-campaign-job`, `create_campaign` | AUT-10 | |
| `create_negative_search_term`, `delete_negative_search_term` | AUT-04 | |
| `add_keyword_search_term` | AUT-03 | |
| `productad_update_state` | AUT-06 | |
| `noti-oob-job`, `noti-oob-job-v2` | ADS-10, PLT-08 | Stream v1 `budget-usage` chết 2027-06-30 → poll v0 budget usage |
| `alert-campaign-job` (lệch Amazon vs DB) | PLT-05 (reconcile) | |
| `budget-job`, `budget_profile` | — **bỏ (internal)**; ý generic → AUT-05 | |
| `inventory_alert` | INV-03 | |
| `notification` | PLT-08 | |
| `portal_platform` | — **bỏ (internal)** | Đồng bộ user từ portal |
| `repush-failed` | PLT-05 (retry / failed jobs BullMQ) | |
| activity-log producers | PLT-06 | |
| `api` (background goroutines) | PLT-05 | |

---

## 3b. Đối chiếu Amazon Ads console (D51)

Nguồn: `docs/discovery/ads-console-features.md` (tài khoản thử chỉ có SB: chi tiết SP/SD chưa đọc — Q-D59).

| Tính năng console | Feature | ads-web có? | Ghi chú parity |
|---|---|---|---|
| Builder: chọn loại campaign + quốc gia | ADS-08 | Có | |
| Builder SP (một trang): ad group, sản phẩm, auto/manual, keyword/product, negatives, bidding strategy, placements, settings | ADS-08 | Có (nhiều bước) | MVP đạt parity trừ các mục ADS-23 |
| Builder SP: Forecast, Targeting with AI, SP video, audiences (beta), video bid adj., "Launch in N countries", Amazon Business site, Across retailers, Rules template | ADS-23 | Không | sau |
| Builder SB: 3 goal, format Collection / Store spotlight / Video, creative | ADS-12 | Có (thiếu "Reserve share of voice") | v1 |
| Builder Display | ADS-13 | Có | v1 |
| Streaming TV | ADS-26 | Không | ngoài |
| Save as draft / View drafts | ADS-15 | Không | v1 |
| Campaign list: tabs, level Campaigns/Ad groups/Targets, KPI strip + chart, 48 cột tuỳ chọn, filter mọi metric, quick chips, date đến Lifetime | ADS-03 | Có (26 cột) | MVP; tìm kiếm ngôn ngữ tự nhiên → AI-01 |
| Customize columns / Compact view | ADS-03 | Một phần | MVP |
| Bulk Enable/Pause/Archive/budget/portfolio/ngày | ADS-04 | Có (thiếu đổi ngày hàng loạt) | MVP, thêm đổi ngày |
| Download table / Create report | ADS-03 (CSV), ADS-19 | Có | |
| Campaign detail: ad groups, placements, audiences, negative targeting, budget rules, settings, history 90 ngày | ADS-05, ADS-11, PLT-06 | Có | Audience bid adj. → ADS-23 |
| Ad group detail: ads, targeting, negative targeting, search terms (65 ngày), settings, history | ADS-06, ADS-07 | Có | |
| Portfolios (list, inline budget/ngày, tạo) | ADS-09 | Có | |
| Budgets (recommendations, missed sales…) | ADS-10 | Có | v1 |
| Rules (budget/bid) | ADS-11, AUT-* | Có | v1 |
| Products (eligibility, trends, add to campaign) | ADS-18 | Có | v1 |
| Targeting cross-campaign (Top performers) | ADS-03 | Có | |
| Bulk operations (spreadsheet) | ADS-21 | Không | sau |
| Recommendations | ADS-16 | Không | v1 |
| Billing | ADS-24 | Không | sau |
| Brand metrics / brand impression share | ADS-25 | Không | sau |
| Ads Agent (AI chat trong console) | AI-01 | Không | v1 |
| Brand Stores, Brand profiles, Creator connections, Creative assets, Creative Studio, Translations, Ads planner, Attribution, AMC, Brand lift, Data manager, Events, Partner Directory, Academy, Verification Center | ADS-26 (ngoài); Creative assets → ADS-12/13; Translations → AI-05 | Không | Không phải quản lý quảng cáo lõi |

**Kết luận parity:** MVP (ADS-01…09 + PLT-06) đạt parity console cho SP ở các màn nó có: list, bulk, builder,
chi tiết campaign/ad group, search terms, portfolio, history. SB/SD/budget/rules/recommendations đạt ở v1.

---

## 3c. AI / MCP (D50 c)

| ID | Xây trên | Tier | Cần có trước |
|---|---|---|---|
| AI-01 | Amazon Ads MCP (`advertising-ai.amazon.com/mcp`, 110 tool / 18 nhóm, open beta): hỏi đáp, report ad-hoc, thao tác campaign/portfolio; mọi tool ghi qua bước duyệt; context FIXED theo seller account; allow-list tool | v1 | PLT-01, PLT-03 (refresh token Ads), PLT-06 (audit), PLT-07 (kết quả ghi từng phần), ADS-01/02 (trả lời bằng dữ liệu có sẵn) |
| AI-02 | SP-API MCP (`sellingpartner-ai.amazon.com/mcp`) | v1 | PLT-02, AI-01 |
| AI-03 | Chẩn đoán doanh số giảm (toolkit `sp-sales-drop`) | sau | ORD-01, CAT-01, INV-01, ADS-02 |
| AI-04 | MCP server riêng của seller-hub (ads + tồn kho + tài chính + lợi nhuận — thứ MCP Amazon không nối được) | sau | FIN-03, INV-02, AI-01; P6-SEC |
| AI-05 | Dịch keyword opt-in | sau | ADS-14 |
| AI-06 | Support case helper | sau | role SPS* |

Lưu ý: MCP **không** có stream, export, budget rules/usage, recommendations, profiles → ingestion và automation
luôn đi API trực tiếp (`ads-mcp.md` §5). Tool connector `analytics_*`, `finances_monthEndClosing`,
`sellerAssistant_*` của toolkit **không phải SP-API public** — không xây tính năng màn hình trên chúng (P1-REF).
MCP đang beta: tên tool có thể đổi.

---

## 4. Thay nguồn dữ liệu (rút gọn từ `legacy-api-domain.md` §2)

| Legacy | Nguồn Amazon / seller-hub | Trạng thái |
|---|---|---|
| Proxy nội bộ giữ LWA (149 lời gọi v0) | Gọi thẳng Ads API bằng token từng seller; entity trên v1 (86 có v1, 11 một phần, 52 ngoại lệ v0 có tên) | xong |
| 27 endpoint riêng của console + cookie bot | **Bỏ.** v1 query + v1 reports + Stream v2 | bỏ |
| CSDL báo cáo (ETL ngoài) | v1 reports do worker ingest; Stream v2 theo giờ | xong; độ phủ field search term / placement / IS cần xác nhận |
| Stream v1 `budget-usage` (OOB) | Poll v0 `spCampaignsBudgetUsage` / `portfolioBudgetUsage` (Stream v2 không có dataset budget) | xong (poll) |
| Metadata sản phẩm | Catalog Items `getCatalogItem` + Ads product metadata (v0) | xong |
| Kho: tồn kho, DOC | `getInventorySummaries`; DOC tính từ `getOrderMetrics` | xong |
| Kho: GMV, affiliate, promo, SKU performance, phòng ban | bỏ hoặc user input | bỏ |
| **COGS** | **Người dùng nhập** (FIN-02) | user input |
| Người phụ trách SKU, phòng ban, team CSV | Tag/nhóm seller account (PLT-10), user input | user input |
| Ngân sách tháng được duyệt (ticket tài chính) | Cap tháng do user nhập (AUT-05) | user input |
| Engine cảnh báo tồn kho (Kafka) | Luật tồn kho của seller-hub + `FBA_INVENTORY_AVAILABILITY_CHANGES` | thiết kế |
| Mô hình automation (bid, budget, search term, tạo campaign) | Rule engine seller-hub (AUT-*) + budget rules / recommendations của Amazon | thiết kế |
| Kafka (trigger, thông báo, log) | BullMQ, bảng `notifications` + SSE, bảng `audit_log` | thiết kế |
| Keycloak / portal / user directory | Auth của BFF seller-hub, user/role theo tenant | thay |
| Ticketing | bỏ | bỏ |
| Product lifecycle / catalog service (ASIN↔SKU) | Listings Items + FBA inventory | xong |
| Object storage wrapper | S3-compatible + link ký tên | xong |
| Chat webhook / mail | Kênh do tenant cấu hình (PLT-08) | thiết kế |
| LLM dịch keyword | Opt-in (AI-05) hoặc bỏ | tuỳ chọn |
| Bảng sản phẩm đối thủ | Ads product recommendations (EX-TARGETING-RECS) | bỏ bảng |
| Brand Stores qua console | v1 `QueryBrandStore*`; `listAsins` v0 | xong |
| Placement Amazon Business (B2B) | **chưa có nguồn** (Q-D57) | chưa giải |
| Gỡ optimization rule khỏi campaign | **không có API public** (ADS-22) | chưa giải |
| Profile discovery | v0 `listProfiles` + v1 `QueryAdvertiserAccount`; SP-API `getMarketplaceParticipations` | xong |

**Khoảng trống Amazon không lấp được:** COGS, chi phí khác, người phụ trách, nhóm/team, cap ngân sách tháng,
quyết định automation, promotions/coupons của vendor (console-only), placement B2B.

---

## 5. Rủi ro và ràng buộc

| # | Rủi ro / ràng buộc | Nguồn | Ảnh hưởng tới kế hoạch |
|---|---|---|---|
| 1 | **Amazon duyệt app.** SP-API app (R5) và Ads API (R6) cần duyệt; SaaS public cần Data Protection audit | ANALYSIS rủi ro 1, D1 | P1–P3 không cần; Gate 3 cần. Bắt đầu R5/R6 ngay. Test account Ads **không có dữ liệu hiệu quả** → test report dùng fixture |
| 2 | **Hạn chót 2027-06-30:** Reporting v3, Sponsored Ads v2 reports, Marketing Stream v1 tắt; `/adsAccounts*` 404 từ 07/2027; SB Product Collection lỗi từ 01/2027 | P1-ADS finding 1, ads-domains §5 | Chỉ xây trên v1 reports + Stream v2; không dùng Product Collection |
| 3 | **Độ phủ v1 reports chưa xác nhận** cho search term, placement, impression share/rank, placement B2B | P1-API Q1/Q3, LA row 2/10/30 | ADS-07, AUT-03/04 phụ thuộc → Q-D57 |
| 4 | **Rate limit Ads:** động, không có bảng; report concurrency có thể = 1 và 1 req/s mỗi client; export ≤ 5 job | ads-domains §2/§3.10 | Lịch report rải trong ngày, ưu tiên Stream v2 khi có; backfill chậm |
| 5 | **Rate limit SP-API rất thấp:** `searchOrders` 0.0056 rps, `createReport`/`getReportDocument` 0.0167, `createFeed` 0.0083, `getMarketplaceParticipations` 0.016 | spapi-domains cross-cutting | Report-first + notification; token bucket theo (seller, operation); không gọi trong request người dùng |
| 6 | **Ghi từng phần (207)**, PUT thay cả bản ghi, mảng placement là cả tập, archive = delete, lỗi trả HTTP 200 trong legacy | ads-domains §2, LW §0, LA trap 2 | PLT-07 là nền của L0; test cho từng kiểu |
| 7 | **20 ngoại lệ v0** (portfolio, budget rules/usage/recs, optimization rules, targeting recs/discovery, exports, history, profiles, billing, brand assets, moderation…) | ads-domains §4 | MVP dùng EX-PORTFOLIOS, EX-EXPORTS, EX-TARGETING-RECS/DISCOVERY, EX-PROFILES, EX-CHANGE-HISTORY; ghi ADR. Lưu ý: P1-REF ghi keyword/negative là v0 — **P1-ADS đúng**: v1 Targets đã gộp keyword, negative keyword, campaign negatives |
| 8 | **Profile id vs advertiser account id** (v1 `alternateIds` chưa xác minh) | ads-domains §1, P1-ADS Q1 | Giữ EX-PROFILES tới khi kiểm bằng tài khoản thật |
| 9 | **Stream v2:** Parquet vào S3 + SQS trong một AWS account; loại account hỗ trợ ghi "Global / DSP regional" | ads-domains §3.11, P1-ADS Q2/Q3 | PLT-12 ở v1, cần R7/D21; Q-D58 |
| 10 | **Dữ liệu hạn chế (PII):** đơn hàng, nhãn MFN, DF vendor, một số report cần RDT + role restricted | spapi-domains §4/§8/§V, D11 | MVP không PII: đơn hàng vẫn đồng bộ (trường PII bị che). `searchOrders` chưa nằm trong danh sách RDT nhưng trả cùng trường → coi như restricted. Client từ chối gọi op restricted |
| 11 | **Khối lượng & lưu trữ:** v1 report: theo giờ 14 ngày, theo ngày 24 tháng (khoảng ≤ 120 ngày), tháng 6 năm; v3 giữ 60–95 ngày; Stream restatement 70 ngày | ads-domains §3.10/§3.11 | Backfill tối đa 24 tháng theo ngày; lưu lịch sử của mình; chính sách giữ log/export (LA trap 18) |
| 12 | **Logic automation không có trong legacy** (bot ngoài repo) | LA §1.7, row 12 | AUT-* là thiết kế mới; L0 chỉ một luật; mặc định preview+approve |
| 13 | **Bảo mật legacy cần thiết kế khác:** route không xác thực, thiếu ACL, log lộ `Authorization`, proxy mở, token bypass | LA traps 3–7 | Default-deny, test ACL mỗi route, log theo allow-list |
| 14 | **Vendor:** promotions/coupons không có API; vendor dùng cùng Ads API (specs) nhưng chưa thử; DF cần RDT | P1-VENDOR, ads-domains §6, P1-REF | VEN-07 sau (chỉ đọc), VEN-09 ngoài; Q-D60/D61 |
| 15 | **Kiểm kê console chưa đủ:** chỉ tài khoản SB; chi tiết SP/SD, thông báo validation, tooltip chưa đọc | P1-CONSOLE | Parity SP dựa thêm vào ads-web + specs; Q-D59 |
| 16 | **MCP Amazon đang beta**, không có bảng tool→API, tool connector toolkit không public | ads-mcp, P1-REF | AI-* sau MVP, allow-list tool, không phụ thuộc cho tính năng lõi |
| 17 | **Phạm vi rộng:** ba sản phẩm benchmark = nhiều năm làm | ANALYSIS rủi ro 4, D56 | L0 mỏng trước; automation từng luật một |

---

## 6. Roles SP-API cần cho MVP đề xuất (để đăng ký app — R5)

| Role | Cần cho | Tier |
|---|---|---|
| **Product Listing** (PL) | CAT-01/02 (`searchListingsItems`, `getCatalogItem`, `GET_MERCHANT_LISTINGS_ALL_DATA`), `getMarketplaceParticipations`, `getOrderMetrics`, `getInventorySummaries` | MVP |
| **Amazon Fulfillment** (AF) | INV-01, ORD-02 (`searchOrders`, order report), ledger report | MVP |
| **Inventory and Order Tracking** (IOT) | ORD-01/ORD-02, listings; vendor PO/invoice | MVP |
| **Finance and Accounting** (FA) | FIN-01 (`listTransactions`, settlement report) | MVP |
| Brand Analytics (BA) | ORD-03, FIN-03 (Data Kiosk economics), CAT-06, VEN-05 — **cần Brand Registry** | v1 (xin luôn nếu có brand) |
| Pricing (PR) | PRC-*, FIN-05 | sau |
| Selling Partner Insights (SPI) | ORD-05, OTH-01 | sau |
| Buyer Communication / Buyer Solicitation (BC/BS) | ORD-04 | sau |
| **Không xin:** Direct to Consumer Shipping\*, Tax Invoicing\*, Tax Remittance\*, Selling Partner Support\*, Professional Services\* | PII / restricted — chỉ khi D11 = có | ngoài |

Vendor (khi làm VEN-*): AF, IOT, BA (cùng app nếu tài khoản vendor được self-authorize; Vendor Central có quy
trình authorize riêng). **Ads API (R6):** LWA security profile + onboarding Ads API, scope
`advertising::campaign_management` (+ `advertising::test:create_account` để tạo test account).

---

## 7. Câu hỏi cho Gate 1

Trả lời ngắn trong chat với orchestrator (ví dụ `D11: mặc định`, `D57: a`) hoặc sửa `docs/DECISIONS.md`.
Lựa chọn đề xuất ghi đầu tiên.

- **D10 — Phạm vi MVP:** tick cột **MVP?** ở §2. Đề xuất của tôi: tất cả dòng `MVP·L0` + `MVP`
  (10 + 13 dòng). Nếu muốn MVP nhỏ hơn: giữ L0 + ADS-04…09 + CAT-01/02, đẩy ORD-02 / FIN-01 sang v1.
- **D11 — PII trong MVP:** đề xuất **không** (mặc định). Đơn hàng vẫn đồng bộ, không có thông tin người mua.
- **D57 — Độ phủ báo cáo v1** (search term, placement, impression share/rank, placement B2B): đề xuất
  (a) dùng v1; nếu một cột thiếu thì ẩn cột đó, ghi ngoại lệ, **không** dùng Reporting v3 (tắt 2027-06-30).
  (b) cho phép Reporting v3 tạm thời như ngoại lệ có tên tới 2027-06-30.
- **D58 — Marketing Stream v2 / AWS:** đề xuất (a) đưa vào v1 (PLT-12), mỗi bản tự host dùng bucket S3 + SQS
  trong AWS của chính seller đó; bản SaaS sau dùng bucket chung, prefix theo tenant. (b) bỏ Stream, chỉ poll
  report (độ tươi ~ ngày).
- **D59 — Kiểm kê console lần 2:** đề xuất (a) có — bạn cung cấp tài khoản có campaign SP/SD (chỉ đọc) để
  đọc nốt chi tiết SP/SD, validation, tooltip; trước P2-DATA. Streaming TV: ngoài phạm vi. (b) không, dựa
  vào ads-web + specs.
- **D60 — Vendor trong MVP:** đề xuất (a) vendor ở **v1** (VEN-01…06 + ADS-20), ngay sau MVP seller.
  (b) đưa VEN-01, VEN-02, VEN-05 (PO + Retail Analytics, chỉ đọc + acknowledge) vào MVP.
- **D61 — Vendor promotions/coupons:** đề xuất (a) chỉ roadmap đọc/nhập tay (VEN-07), không scrape console;
  kiểm `promotions@2025-12-01` với tài khoản vendor khi có; chạy lại P1-VENDOR với tài khoản 1P US không DF
  nếu bạn có. (b) bỏ hẳn.
- **D62 — Độ tươi dữ liệu (thay "real-time mode" legacy):** đề xuất (a) **một chế độ**: dữ liệu mirror trong
  DB, làm mới entity ngay sau mỗi lần ghi, nút "làm mới" theo campaign, Stream v2 ở v1. (b) thêm chế độ đọc
  trực tiếp Amazon cho campaign đang chạy/hết budget.
- **D63 — Mức tự động của luật trong MVP:** đề xuất (a) luật L0 mặc định **preview + duyệt**; chế độ tự chạy
  (`rule+cap`) chỉ bật khi Owner/Admin đặt giới hạn (% đổi tối đa/ngày, sàn/trần bid). (b) chỉ preview + duyệt.
