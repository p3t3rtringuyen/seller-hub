# RESOURCES

Những thứ chỉ bạn cung cấp được, và lúc nào cần. **Secret chỉ nằm trong `.env.local`, do bạn tự
điền. Không dán vào chat.** Agent kiểm tra bằng `node scripts/check-env.mjs <PREFIX>` — chỉ in tên
biến đã có / còn thiếu.

| ID | Cần trước | Thứ cần | Ai làm |
| --- | --- | --- | --- |
| R1 | Gate 0 | Công cụ trên máy | Bạn |
| R2 | P1 | 5 repo Amazon trong `refs/amazon` | Orchestrator (script) |
| R3 | P1 | Quyền đọc repo legacy | Bạn bấm Allow khi được hỏi |
| R4 | P1-ADS | Spec + tài liệu Amazon Ads API và MCP | Script (đã chạy 2026-10-14) |
| R5 | Gate 3 | App SP-API + refresh token | Bạn (bắt đầu sớm) |
| R6 | Gate 3 | Quyền Amazon Ads API + refresh token | Bạn (bắt đầu sớm — chờ duyệt) |
| R7 | P4 notifications / P6 | Tài khoản AWS, hàng đợi SQS | Bạn |
| R8 | khi muốn CI | Repo GitHub private | Bạn |
| R9 | P3-DS (tuỳ chọn) | Link Figma nếu có thiết kế | Bạn |
| R10 | P6 | Domain, hosting | Bạn |
| R11 | P1-CONSOLE | Chrome có Claude extension, đã đăng nhập Amazon Ads console; URL Campaign Builder | Bạn |

## R1 — Công cụ
- Git, Node 22 LTS, pnpm (`corepack enable`), Docker Desktop (đang chạy), PowerShell.
- Nếu D3 = (b): Go 1.24.
- Claude desktop app, có quyền dùng Opus 5.5, Sonnet 5.5, Haiku 5.5.

## R2 — Repo tham chiếu của Amazon
Orchestrator chạy `powershell -File scripts/fetch-refs.ps1` (clone nông, ghi commit vào
`refs/amazon/VERSIONS.txt`). Chạy lại để cập nhật khi Amazon đổi model. `refs/` không vào git.

## R3 — Repo legacy (chỉ đọc)
Khai báo trong `.claude/settings.json` → `permissions.additionalDirectories`:

| Repo | Đường dẫn | Đọc để lấy |
| --- | --- | --- |
| ads-web | `C:\Users\trinh\Projects\ads-web` | màn hình, cột, filter, form, quy tắc UX, endpoint gọi |
| ads-api | `C:\Users\trinh\Projects\ads-api` | entity, use case, job/cron, consumer, phụ thuộc nội bộ cần thay |
| ads-redesign | `C:\Users\trinh\Projects\ads-redesign` | mẫu auth BFF (token không xuống trình duyệt) |

Nếu D9 thêm repo khác, orchestrator thêm đường dẫn vào settings. Không bao giờ cấp quyền ghi.

## R4 — Spec và tài liệu Amazon Ads API + MCP
`node scripts/fetch-ads-refs.mjs` sao toàn bộ trang docs advertising.amazon.com/API/docs vào
`refs/amazon-ads/`, theo đúng mục lục của chính trang đó: 223 spec (API v0 cổ điển, API v1 hợp
nhất, 18 nhóm tool của Ads MCP Server) và 807 trang tài liệu (guides, reference, MCP, workshop,
release notes). Danh sách ở `refs/amazon-ads/INDEX.md`, nguồn và sha256 ở `manifest.json`. Chạy lại
để cập nhật. Đã chạy 2026-10-14: 1030 file, ~31 MB, 0 lỗi (5 spec DSP beta của Amazon bị lỗi JSON
từ gốc).

## R5 — App SP-API (bắt đầu ngay, không chặn P1/P2)
1. Seller Central, đăng nhập bằng primary account user → **Apps and Services → Develop Apps**.
2. Tạo developer profile: **Private developer** nếu D1 = (a)/(c) (app cho tổ chức của bạn);
   **Public developer** nếu D1 = (b) — sẽ có vòng duyệt và câu hỏi bảo mật.
3. Chọn roles theo `docs/SCOPE.md` (P1-SCOPE liệt kê). Role bị hạn chế (PII) chỉ khi D11 = có.
4. **Add new app client** → loại SP API → lấy LWA client id / client secret.
5. **Authorize** (self-authorization) → lấy refresh token.
6. Điền vào `.env.local`: `SPAPI_LWA_CLIENT_ID`, `SPAPI_LWA_CLIENT_SECRET`, `SPAPI_REFRESH_TOKEN`,
   `SPAPI_REGION`, `SPAPI_MARKETPLACE_IDS`. (`SPAPI_APP_ID` chỉ cần cho luồng OAuth của app public.)
Sandbox SP-API dùng chính app này, không cần đăng ký thêm.

## R6 — Amazon Ads API (bắt đầu ngay — có thể chờ duyệt vài ngày)
1. Tạo **Login with Amazon security profile** trên developer.amazon.com.
2. Đăng ký Amazon Ads API tại advertising.amazon.com/API (onboarding) với security profile đó; chờ
   duyệt.
3. Sau khi được duyệt: chạy OAuth consent với một tài khoản quảng cáo (scope
   `advertising::campaign_management`) → refresh token. Có thể tạo test account qua Ads API.
4. Điền `.env.local`: `ADS_LWA_CLIENT_ID`, `ADS_LWA_CLIENT_SECRET`, `ADS_REFRESH_TOKEN`,
   `ADS_REGION`.

## R7 — AWS
Cần khi thử notification thật (SP-API Notifications → SQS / EventBridge; Ads Marketing Stream →
SQS) và khi deploy cloud. Một AWS account, một IAM user/role cho dev, region trùng khu vực
marketplace. Chi tiết hàng đợi do P3-INGEST viết ra trong `docs/architecture/`.

## R8 — GitHub private repo
Tạo repo trống, thêm remote, rồi bảo orchestrator. Mở được CI và cloud session.

## R9 — Thiết kế
Nếu có Figma, đưa link trước P3-DS. Không có thì P3-DS dựng giao diện trung tính theo quy tắc UX
rút ra từ ads-web.

## R10 — Hosting, domain
Theo D21/D40, trước P6-DEPLOY.

## R11 — Amazon Ads console trong Chrome (cho P1-CONSOLE)
Chrome đang mở, extension Claude in Chrome đã kết nối, đã đăng nhập advertising.amazon.com với
một tài khoản quảng cáo. Đưa orchestrator URL Campaign Builder (`…/cb?entityId=…`). URL không được
ghi vào file nào trong repo. Session chỉ đọc: không bấm Launch/Save/Apply/Pause/Delete…, không ghi
dữ liệu tài khoản (tên, ASIN, số tiền), chỉ ghi cấu trúc màn hình. Trong lúc nó chạy, đừng dùng tab
của nó.
