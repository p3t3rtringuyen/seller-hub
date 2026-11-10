# DECISIONS

Bạn quyết định; orchestrator ghi lại. Trả lời bằng cách sửa dòng **Trả lời** trong file này,
hoặc gõ trong chat với orchestrator: `D1: c`, `D*: mặc định` (nhận mọi mặc định của cổng hiện
tại). Trạng thái: `OPEN` → `DECIDED (ngày)`.

Agent coi mục `DECIDED` là ràng buộc. Câu hỏi mới phát sinh trong lúc làm được orchestrator thêm
vào cuối file với số tiếp theo.

---

## Gate 0 — trước khi bắt đầu

### D0 — Quyền dùng code ads-web / ads-api
- Trạng thái: DECIDED (2026-11-09) · Mặc định: **clean room**
- Code thuộc Yes4All. Hệ thống mới dành cho seller khác.
- (a) **Clean room**: agent chỉ đọc code cũ để kiểm kê tính năng, quy tắc nghiệp vụ, edge case;
  code mới viết lại hoàn toàn, không mang tên/host nội bộ Yes4All.
- (b) Được phép tái sử dụng code (bạn đã có văn bản cho phép của công ty).
- Trả lời: a — clean room.

### D1 — Mô hình triển khai "cho bất kỳ seller nào"
- Trạng thái: DECIDED (2026-11-09) · Mặc định: **(c)**
- (a) Tự host đơn tenant: mỗi seller tự deploy, tự đăng ký app SP-API **private** và app Ads API
  của họ. Không cần Amazon duyệt app công khai.
- (b) SaaS đa tenant: bạn là **public developer**; Amazon duyệt app, yêu cầu audit bảo mật theo
  Data Protection Policy; seller kết nối qua OAuth.
- (c) Schema và code đa tenant ngay từ đầu, triển khai kiểu (a) trước; mở (b) sau khi qua P6-SEC.
- Trả lời: c — schema đa tenant, tự host trước; mở SaaS public sau P6-SEC.

### D2 — Phạm vi API
- Trạng thái: DECIDED (2026-11-09) · Mặc định: **(a)**
- (a) SP-API + Amazon Ads API (thay được ads-web và mở rộng sang vận hành).
- (b) Chỉ SP-API (không có quản lý quảng cáo — không thay được ads-web).
- Trả lời: a — SP-API + Amazon Ads API.

### D3 — Stack
- Trạng thái: DECIDED (2026-11-09) · Mặc định: **(a)**
- (a) **TypeScript toàn bộ**: Next.js App Router (BFF) + API Node (NestJS hoặc Fastify, chốt ở
  ADR) + worker hàng đợi (BullMQ/Redis) + PostgreSQL 16. Lý do: SDK chính thức của Amazon có
  JavaScript (kèm LWA và rate limiter), không có Go; một ngôn ngữ cho FE/BE → chung kiểu DTO,
  các session song song ít lệch nhau.
- (b) Go backend (Gin/fx như ads-api) + Next.js. Đội quen; nhưng phải tự sinh client từ model và tự
  viết LWA, rate limiter, Restricted Data Token.
- Trả lời: a — TypeScript toàn bộ (Node API + Next.js BFF + BullMQ worker + PostgreSQL 16).

### D4 — Khu vực / marketplace đầu tiên
- Trạng thái: DECIDED (2026-11-09) · Mặc định: **NA, US (`ATVPDKIKX0DER`)**; schema hỗ trợ đủ NA/EU/FE từ đầu.
- Trả lời: mặc định — NA, US (`ATVPDKIKX0DER`); schema hỗ trợ NA/EU/FE.

### D5 — Seller hay Vendor
- Trạng thái: DECIDED (2026-11-09) · Mặc định: **chỉ Seller**. Các API `vendor-*` để ngoài phạm vi.
- Trả lời: **Seller + Vendor.** Seller trước trong lát cắt đầu; Vendor (gồm Vendor Central Promotion Central, `vendor-*` SP-API) là phạm vi sản phẩm, xếp wave ở P1-SCOPE.

### D6 — Phân vai model và song song
- Trạng thái: DECIDED (2026-11-09) · Mặc định: như `docs/PLAN.md` (Opus 5.5 điều phối/thiết kế/review,
  Sonnet 5.5 viết code, Haiku 5.5 việc cơ học); tối đa **3** session viết code cùng lúc.
- Trả lời: mặc định — như `docs/PLAN.md`.

### D7 — Remote git
- Trạng thái: DECIDED (2026-10-14)
- Remote: `origin` = github.com/p3t3rtringuyen/seller-hub (private), nhánh `main`.
- Agent vẫn **không push** khi chưa có lệnh của bạn; orchestrator chỉ push khi bạn bảo.
- Trả lời: GitHub private repo ở trên.

### D8 — Tên sản phẩm / repo
- Trạng thái: DECIDED (2026-11-09) · Mặc định: `seller-hub`
- Trả lời: mặc định — `seller-hub`.

### D9 — Nguồn legacy bổ sung
- Trạng thái: DECIDED (2026-11-09) · Mặc định: **không**. Chỉ kiểm kê ads-web, ads-api (và ads-redesign cho mẫu
  auth BFF).
- Có thể thêm: `catalog-web`, `products-web`, `promotion-web`, `master-data-web`, `portal-web` nếu
  muốn hệ thống mới gồm cả các mảng đó.
- Trả lời: không.

---

## Gate 1 — sau kiểm kê (P1-SCOPE)

### D10 — Phạm vi MVP
- Trạng thái: DECIDED (2026-11-10) · Cách trả lời: tick cột **MVP?** trong `docs/SCOPE.md`.
- Gợi ý: một lát cắt đầu-cuối mỏng trước (kết nối seller → đồng bộ listing → hiển thị), rồi Ads
  SP campaigns + báo cáo, rồi tồn kho / đơn hàng / tài chính.
- Trả lời: theo đề xuất — 23 dòng `MVP·L0` + `MVP` đã tick trong `docs/SCOPE.md` §2 (lát 0 làm trước).

### D11 — Dữ liệu PII (tên/địa chỉ người mua) trong MVP?
- Trạng thái: DECIDED (2026-11-10) · Mặc định: **không**. Cần role bị hạn chế, Amazon duyệt thêm, mã hoá và xoá
  theo hạn lưu trữ. Đơn hàng vẫn đồng bộ được, chỉ không có thông tin người mua.
- Trả lời: không (mặc định).

---

## Gate 2 — sau thiết kế (P2)

### D20 — Duyệt kiến trúc
- Trạng thái: OPEN · Cách trả lời: đọc `docs/adr/`; `duyệt`, hoặc ghi ADR nào cần đổi và vì sao.
- Trả lời: _

### D21 — Môi trường production
- Trạng thái: OPEN · Mặc định: **docker compose** cho seller tự host + **AWS** cho bản cloud (vì
  SP-API Notifications và Ads Marketing Stream giao qua SQS/EventBridge).
- Trả lời: _

---

## Gate 3 — trước khi gọi Amazon thật

### D30 — Tài khoản seller dùng để test
- Trạng thái: OPEN · Mặc định: **chỉ sandbox SP-API + test account của Ads API**.
- Lưu ý: dùng tài khoản seller thật của Yes4All để test một sản phẩm riêng cần công ty cho phép.
  Nếu dùng tài khoản thật, chỉ gọi thao tác **đọc** cho tới khi bạn mở thêm.
- Trả lời: _

---

## Gate 4 — trước khi triển khai

### D40 — Hosting, domain, người vận hành
- Trạng thái: OPEN
- Trả lời: _

---

## Phát sinh trong lúc làm

<!-- Orchestrator thêm D54, D55… tại đây: câu hỏi, lựa chọn, đề xuất, task nêu ra. -->

### D50 — Phát triển trên Amazon Ads MCP Server (open beta)
- Trạng thái: DECIDED (2026-10-14) — **(c)**
- Bạn muốn phát triển phần này (2026-10-14). Ads MCP Server là server Amazon host
  (`advertising-ai.amazon.com/mcp`, có bản `/mcp/lite`), đăng nhập LWA OAuth 2.1, dùng chung quyền
  Ads API; Claude/ChatGPT/agent tự viết kết nối vào được. SP-API có server tương tự
  (`sellingpartner-ai.amazon.com/mcp`, trong agentic toolkit).
- (a) Trợ lý AI trong seller-hub, làm **client** của MCP Amazon (Ads + SP-API): người dùng hỏi /
  ra lệnh, mọi thao tác ghi phải được duyệt.
- (b) seller-hub tự mở **MCP server riêng** trên dữ liệu của mình (ads + tồn kho + tài chính +
  lợi nhuận — thứ MCP của Amazon không nối được), để Claude/ChatGPT điều hành cả doanh nghiệp.
- (c) Cả hai: (a) sau MVP, (b) tiếp theo.
- Trả lời: **c** — trợ lý AI dùng MCP của Amazon trước, MCP server riêng của seller-hub sau.

### D51 — Chuẩn tính năng quảng cáo
- Trạng thái: DECIDED (2026-10-14, theo yêu cầu của bạn)
- Tính năng quảng cáo bám theo **Amazon Ads console** (Campaign Builder, Campaign Manager); ads-web
  cũng đã bắt chước nó. P1-CONSOLE kiểm kê console (chỉ đọc) làm chuẩn đối chiếu.
- Chép tính năng và luồng làm việc, không chép thương hiệu / giao diện nhận diện của Amazon.

### D52 — Cách gọi Amazon
- Trạng thái: DECIDED (2026-10-14, theo yêu cầu của bạn)
- Gọi đúng các operation và header của Amazon Ads API mà ads-api đang gọi (ads-api đi qua proxy
  nội bộ `/amz_y4a/...` với đường dẫn y hệt API của Amazon). seller-hub gọi **thẳng** Amazon bằng
  credential LWA của từng seller đã kết nối — proxy nội bộ không dùng được ngoài Yes4All.
  P1-API lập bảng đối chiếu từng lời gọi.
- Credential dùng để test xem D30 (tài khoản API của Yes4All cần công ty đồng ý).

### D53 — Thế hệ Ads API
- Trạng thái: DECIDED (2026-10-14) — **(b) Amazon Ads API v1**
- (a) API v0 / classic (SP v3, SB v4, SD — ads-api đang dùng). (b) **Amazon Ads API v1** hợp nhất
  (mới; Amazon đã phát hành bộ skill hướng dẫn chuyển đổi). (c) v0 cho phần đã có tương đương, v1
  cho phần mới.
- Trả lời: **mới (v1)**. Cách hiểu đang áp dụng: v1 là mặc định cho mọi thứ v1 có. Chỗ v1 chưa có
  (theo mục lục docs hiện tại: portfolios, budget rules và một số API khác) dùng v0, và **mỗi chỗ là
  một ngoại lệ có tên** trong `docs/discovery/ads-domains.md` / ADR, để gỡ khi v1 bổ sung.

### D54 — Bộ kiểm thử front-end
- Trạng thái: DECIDED (2026-11-09) · Mặc định: **(a)** (theo brief PO 2026-11-02)
- (a) Vitest + React Testing Library (unit), Storybook cho mọi component + interaction tests
  (`@storybook/test`), Playwright (e2e). Chạy trong Turborepo pipeline, CI chặn merge khi đỏ.
- (b) Như (a) nhưng không Storybook (giảm chi phí bảo trì).
- Trả lời: a — Vitest + RTL, Storybook + interaction tests, Playwright.

### D55 — Mô hình phân quyền (RBAC)
- Trạng thái: DECIDED (2026-11-09) · Mặc định: **(a)**
- (a) Tenant → user có **role** cố định: Owner, Admin, Manager (ghi campaign), Analyst (đọc + báo
  cáo), Viewer. Quyền kiểm tra ở API; UI ẩn/khoá theo quyền. Phạm vi theo seller account.
- (b) Như (a) + role tuỳ biến (permission-set do tenant tự định nghĩa). Linh hoạt hơn, tốn ~1 slice.
- Trả lời: a — role cố định Owner/Admin/Manager/Analyst/Viewer, phạm vi theo seller account.

### D56 — Chuẩn tính năng từ sản phẩm thị trường
- Trạng thái: DECIDED (2026-11-09) · Mặc định: **có** (theo brief PO 2026-11-02)
- P1-REF kiểm kê tính năng công khai của Pacvue / Perpetua (Sellics), Helium 10 Adtomic, Skai /
  ProfitlogiQ (tài liệu, help center) làm nguồn ý tưởng cho `docs/SCOPE.md`: tối ưu tự động, nối
  dữ liệu bán hàng + tồn kho + ads, gợi ý/harvest từ khoá, rule-based bidding, dayparting, pacing
  ngân sách, phân tích AI. Chỉ lấy yêu cầu, không chép UI/thương hiệu.
- Trả lời: có.

### D57 — Độ phủ báo cáo Ads v1 (search term, placement, impression share, B2B)
- Trạng thái: DECIDED (2026-11-10) · Mặc định đề xuất: **(a)** · Nêu bởi P1-SCOPE (từ P1-API Q1/Q3)
- (a) Chỉ dùng v1 reports; cột nào v1 thiếu thì ẩn và ghi ngoại lệ; không dùng Reporting v3 (tắt 2027-06-30).
- (b) Cho phép Reporting v3 tạm thời như ngoại lệ có tên tới 2027-06-30.
- Trả lời: a.

### D58 — Amazon Marketing Stream v2 và AWS
- Trạng thái: DECIDED (2026-11-10) · Mặc định đề xuất: **(a)** · Nêu bởi P1-SCOPE (từ P1-ADS Q2/Q3)
- (a) Stream v2 ở v1 (PLT-12); bản tự host dùng S3 + SQS trong AWS của chính seller; SaaS sau dùng bucket chung, prefix theo tenant.
- (b) Không dùng Stream; chỉ poll report (độ tươi ~ ngày).
- Trả lời: a.

### D59 — Kiểm kê Ads console lần 2 (SP/SD)
- Trạng thái: DECIDED (2026-11-10) · Mặc định đề xuất: **(a)** · Nêu bởi P1-SCOPE (từ P1-CONSOLE)
- (a) Bạn cấp tài khoản có campaign SP/SD (chỉ đọc) để đọc chi tiết SP/SD, validation, tooltip trước P2-DATA. Streaming TV ngoài phạm vi.
- (b) Không; dựa vào ads-web + specs.
- Trả lời: a — chờ bạn đưa URL/tài khoản có campaign SP/SD; chưa có thì P2 dựa vào ads-web + specs và ghi rõ chỗ thiếu.

### D60 — Vendor trong MVP
- Trạng thái: DECIDED (2026-11-10) · Mặc định đề xuất: **(a)** · Nêu bởi P1-SCOPE (D5, P1-VENDOR)
- (a) Vendor ở v1 (VEN-01…06 + ADS-20) ngay sau MVP seller.
- (b) Đưa VEN-01, VEN-02, VEN-05 (PO + Retail Analytics) vào MVP.
- Trả lời: a — Vendor ở v1.

### D61 — Vendor promotions / coupons (console-only)
- Trạng thái: DECIDED (2026-11-10) · Mặc định đề xuất: **(a)** · Nêu bởi P1-SCOPE (từ P1-VENDOR Q1/Q2)
- (a) Roadmap đọc/nhập tay (VEN-07), không scrape console; kiểm `promotions@2025-12-01` với tài khoản vendor; chạy lại P1-VENDOR với tài khoản 1P US không DF nếu có.
- (b) Bỏ hẳn.
- Trả lời: a.

### D62 — Độ tươi dữ liệu (thay "real-time mode" của legacy)
- Trạng thái: DECIDED (2026-11-10) · Mặc định đề xuất: **(a)** · Nêu bởi P1-SCOPE (từ P1-WEB)
- (a) Một chế độ: mirror trong DB, làm mới entity ngay sau khi ghi, nút làm mới theo campaign, Stream v2 ở v1.
- (b) Thêm chế độ đọc trực tiếp Amazon cho campaign đang chạy / hết budget.
- Trả lời: a.

### D63 — Mức tự động của luật trong MVP
- Trạng thái: DECIDED (2026-11-10) · Mặc định đề xuất: **(a)** · Nêu bởi P1-SCOPE (từ P1-API Q5, P1-WEB)
- (a) Luật L0 mặc định preview + duyệt; tự chạy (`rule+cap`) chỉ khi Owner/Admin đặt giới hạn (% đổi tối đa/ngày, sàn/trần bid).
- (b) Chỉ preview + duyệt.
- Trả lời: a.

### D64 — Thời gian lưu dữ liệu vận hành
- Trạng thái: OPEN · Mặc định đề xuất: **(a)** · Nêu bởi P2-ARCH (ADR-0009)
- (a) Payload thô của report/export (object storage) 35 ngày; lịch sử chạy job 90 ngày; audit log và lịch sử
  thay đổi 25 tháng (≥ 24 tháng dữ liệu báo cáo Ads); dữ liệu fact giữ đến khi xoá seller account. Đổi được
  bằng biến môi trường.
- (b) Giữ audit log / lịch sử thay đổi vô thời hạn (tốn dung lượng hơn, phù hợp nếu cần kiểm toán dài hạn).
- (c) Bạn đặt con số khác.
- Trả lời: _
