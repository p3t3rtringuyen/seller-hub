# seller-hub — Bộ khởi động

Hệ thống quản lý bán hàng Amazon cho **bất kỳ seller nào** (không riêng Yes4All): quảng cáo
(Amazon Ads API) + vận hành (SP-API: listing, đơn hàng, tồn kho FBA, inbound, tài chính, giá,
thông báo…), DB riêng. Code được viết bởi nhiều session Claude do **một orchestrator** điều phối;
bạn chỉ ra quyết định và cung cấp tài nguyên.

> `seller-hub` là tên tạm (D8). Đổi tên thư mục trước khi mở orchestrator nếu muốn.

## 1. Bốn điều cần biết trước

1. **Cả 5 repo bạn đưa đều là SP-API, không phải Ads API.** ads-web/ads-api là hệ thống
   *quảng cáo*, chạy trên Amazon Ads API — một API khác, đăng ký riêng, spec tải riêng từ
   advertising.amazon.com. Muốn "giống ads-web nhưng đầy đủ hơn" thì cần cả hai. Mặc định của
   kit: cả hai (D2).
2. **ads-api không tự lấy dữ liệu từ Amazon.** Nó ghi qua service nội bộ `amz_y4a` và đọc báo
   cáo từ DB nội bộ Yes4All (CDH, Datamart, warehouse), cùng Keycloak và Kafka nội bộ. Hệ thống
   mới phải tự kéo toàn bộ dữ liệu (Ads Reporting v3, Marketing Stream, SP-API Reports / Data
   Kiosk / Notifications). Đây là phần việc lớn nhất. Vì vậy DB được thiết kế từ **model của
   Amazon**; code cũ chỉ cho biết **cần tính năng gì** và quy tắc nghiệp vụ nào đáng giữ.
3. **"Cho bất kỳ seller nào" có hai nghĩa**: tự host (mỗi seller tự đăng ký app private —
   đơn giản) hoặc SaaS (bạn là public developer: Amazon duyệt app, audit bảo mật DPP, dữ liệu PII
   bị hạn chế). Mặc định: schema đa tenant, triển khai tự host trước (D1). Phí SP-API cho
   developer mà Amazon định thu năm 2026 đã bị huỷ (05/2026).
4. **Code ads-web/ads-api thuộc Yes4All.** Kit làm theo kiểu "clean room": agent đọc code cũ để
   kiểm kê tính năng và quy tắc, rồi viết code mới, không sao chép. Bạn cần tự xác nhận quyền
   dùng (D0).

## 2. Cách vận hành

```
Bạn ──(quyết định, "tiếp")──► Orchestrator  (Opus 5.5 — session bạn mở)
                                 │  start_session theo docs/PLAN.md
         ┌──────────────┬────────┴────────┬───────────────────┐
     Kiểm kê (P1)    Thiết kế (P2)   Xây dựng (P3, P4)     Review / QA (P5)
   Sonnet + Haiku    Opus + Sonnet   Sonnet, mỗi task       Opus review,
   đọc, viết docs    ADR, DB, backlog  một git worktree      Haiku chạy QA
```

| Model | Vai | Task |
| --- | --- | --- |
| **Opus 5.5** | Điều phối, phán đoán khó: tổng hợp phạm vi, kiến trúc, data model, review, bảo mật | orchestrator, P1-SCOPE, P2-ARCH, P2-DATA, P5-REVIEW, P6-SEC |
| **Sonnet 5.5** | Kiểm kê cần hiểu code, viết code chính | P1-SPAPI/ADS/WEB/API, P2-BACKLOG, P3-*, P4-*, P6-DEPLOY |
| **Haiku 5.5** | Việc cơ học, đọc nhiều rồi tóm tắt, chạy checklist | P1-REF, P3-SMOKE, P5-QA |

| Pha | Việc | Cổng — bạn làm gì |
| --- | --- | --- |
| P0 | Orchestrator: git init, tải 5 repo Amazon, kiểm tra quyền đọc repo cũ | **Gate 0**: D0–D9, R1–R3 |
| P1 | Kiểm kê SP-API, Ads API + Ads MCP, Amazon Ads console, ads-web, ads-api, mẫu Amazon → `docs/SCOPE.md` | **Gate 1**: tick MVP trong SCOPE.md, D10–D11, D50 |
| P2 | Kiến trúc (ADR), data model (DDL), backlog chia lát cắt | **Gate 2**: duyệt ADR + backlog, D20–D21 |
| P3 | Nền móng: monorepo, Amazon clients, auth/tenant/kết nối seller, ingestion, design system | **Gate 3**: điền `.env.local`, D30 → smoke test |
| P4 | Lát cắt tính năng, song song theo wave | Chỉ trả lời khi có `NEEDS_DECISION` |
| P5 | Review (Opus) + QA (Haiku) cho mỗi nhánh trước khi merge | — |
| P6 | Rà soát bảo mật theo DPP, triển khai | D40 hosting |

## 3. Các bước của bạn

**Bước 0 — Cài công cụ (R1).** Git, Node 22 LTS, pnpm (`corepack enable`), Docker Desktop.
Chi tiết: [docs/RESOURCES.md](docs/RESOURCES.md).

**Bước 1 — Quyết định Gate 0.** Mở [docs/DECISIONS.md](docs/DECISIONS.md), đọc D0–D9. Mỗi mục có
mặc định đề xuất. Sửa cột "Trả lời" trong file, hoặc trả lời orchestrator trong chat
(`D1: c`, hay `D*: mặc định`).

**Bước 2 — Mở orchestrator.**
1. Claude desktop → Code → New session → chọn thư mục `C:\Users\trinh\Projects\seller-hub`.
2. Model **Opus 5.5** (bắt buộc: một session chỉ khởi được session cùng hạng hoặc rẻ hơn nó).
   Permission mode: Auto (hoặc Accept edits).
3. Dán đúng một dòng:

   ```
   Bạn là orchestrator của seller-hub. Đọc prompts/00-orchestrator.md và làm theo.
   ```

   Nó sẽ hỏi Gate 0 nếu còn thiếu, rồi tự bootstrap và khởi 4–5 session kiểm kê song song.

**Bước 3 — Trong lúc P1 chạy, làm sẵn việc tốn ngày.** Đăng ký SP-API developer (R5) và xin
quyền Amazon Ads API (R6) — duyệt có thể mất vài ngày. Không chặn P1/P2.

**Bước 4 — Gate 1.** Đọc `docs/SCOPE.md`, tick cột MVP, trả lời D10–D11, gõ `duyệt`.

**Bước 5 — Gate 2.** Đọc `docs/adr/` và `docs/BACKLOG.md`; gõ `duyệt` hoặc ghi chỗ cần sửa.

**Bước 6 — Gate 3.** Tự điền `.env.local` (copy từ `.env.example`). **Không dán secret vào
chat.** Gõ `tiếp` → orchestrator chạy smoke test với Amazon.

**Bước 7 — P4.** Mỗi khi orchestrator báo một đợt xong, gõ `tiếp`. Chỉ phải nghĩ khi có câu
hỏi `NEEDS_DECISION`.

**Bước 8 — P6.** Chọn hosting (D40), cung cấp tài khoản cloud/domain (R7, R10).

## 4. Lệnh dùng với orchestrator

| Bạn gõ | Orchestrator làm |
| --- | --- |
| `tiếp` | Khởi các task đã sẵn sàng |
| `duyệt` | Qua cổng hiện tại |
| `trạng thái` | Tóm tắt: đang chạy gì, chờ gì, chờ bạn gì |
| `D12: b` | Ghi quyết định vào DECISIONS.md rồi chạy tiếp |
| `dừng P4-S03` | Dừng session của task đó |

## 5. Giới hạn cần biết

- **Bạn sẽ gõ `tiếp` ở mỗi ranh giới đợt.** App không cho một session khởi session mới trong
  lượt mà nó bị đánh thức bởi session con báo xong. Đó cũng là điểm kiểm soát chi phí.
- **Chi phí token** tăng theo số session song song. Giới hạn ở D6 (mặc định 3 session viết code
  cùng lúc).
- **Chỉ một session chạy stack đầy đủ (docker) cùng lúc**, trừ khi port đã tách theo
  `COMPOSE_PROJECT_NAME` (P3-SCAFFOLD làm việc này).
- Không gì được push lên remote khi bạn chưa bảo.
- Dùng Claude Code CLI thay vì desktop: orchestrator dùng subagent (`Agent` tool, `model`,
  `isolation: worktree`) thay cho `start_session`; mất khả năng mở từng session ra để nói chuyện.

## 6. Thư mục

```
CLAUDE.md                 luật chung cho mọi session (tự nạp)
docs/PLAN.md              task, model, phụ thuộc, đầu ra — nguồn sự thật của orchestrator
docs/DECISIONS.md         các quyết định của bạn
docs/RESOURCES.md         tài nguyên bạn cần cung cấp, và khi nào
docs/STATUS.md            orchestrator ghi: đang chạy / xong / chờ
docs/reports/             mỗi task để lại một báo cáo
prompts/                  brief cho từng loại task
scripts/fetch-refs.ps1    tải 5 repo Amazon vào refs/amazon (gitignored)
scripts/fetch-ads-refs.mjs  sao spec + docs Amazon Ads API và MCP vào refs/amazon-ads (gitignored)
scripts/check-env.mjs     kiểm tra biến nào trong .env.local đã có, không in giá trị
```
