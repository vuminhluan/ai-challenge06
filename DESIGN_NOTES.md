# Design Notes — Policy Benefits Calculator (tạm)

> File ghi chú tạm các quyết định thiết kế. Sẽ chuyển nội dung chính thức sang README sau.

## 1. Phạm vi

- Xây dựng **calculator** (module/function tái sử dụng), không phải hệ thống (không UI, DB, API).
- Hàm cốt lõi: `calculate(policy, expenses) → { results per expense, summary }`
- Xử lý **theo lô, có trạng thái**: sắp expense theo ngày, xử lý lần lượt; expense trước tiêu hao hạn mức, lượt khám, deductible và ảnh hưởng expense sau.
- Policy áp dụng cho **1 thành viên**.

## 2. Các quyết định đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Chuỗi xử lý 5 bước (mục 3), **per-visit cap đứng trước deductible** | Deductible chỉ tính trên phần chi phí hợp lệ; nếu trừ deductible trước thì deductible bị "trả" bằng phần vượt trần mà bảo hiểm vốn không chi |
| D2 | **Deductible đứng trước copay** | Chuẩn ngành |
| D3 | `effective_date` và `expiry_date` đặt trong **policy**, không đặt trong expense | Là thuộc tính của hợp đồng; tránh lặp dữ liệu và mâu thuẫn giữa các expense |
| D4 | Overlapping benefits: làm **(a) hạn mức lồng nhau** và **(b) quỹ chung giữa nhiều benefit** (`limit_groups`) | (a) gần như bắt buộc vì đề có cả annual limit và sub-limit; (b) dùng cùng cơ chế |
| D5 | **Mỗi expense = 1 lượt khám** | Đơn giản, ghi rõ là giả định |
| D6 | **Deductible theo từng benefit**, tính theo năm | Chi phí các loại benefit chênh nhau xa (OPD và IPD); khớp với cấu trúc lồng nhau; benefit không cần thì đặt 0 |
| D7 | 4 decision: `COVERED`, `PARTIALLY_COVERED`, `NO_PAYOUT`, `DENIED` (mục 4) | `NO_PAYOUT` bao mọi trường hợp expense hợp lệ nhưng covered = 0 (do deductible và/hoặc copay) |
| D8 | Copay có 2 loại: `PERCENTAGE` và `FIXED`. Copay cố định = `min(value, phần còn lại)` | Copay không được vượt quá số tiền còn lại |
| D9 | Exclusion xác định bằng **so khớp keyword** (không phân biệt hoa thường) trong `diagnosis` | Đơn giản, minh bạch; hệ thống thật dùng ICD-10 |
| D10 | Ngôn ngữ: **JavaScript** | |
| D11 | Thứ tự xử lý: sắp theo `date`, cùng ngày thì theo `expense_id` | Kết quả xác định (deterministic), không phụ thuộc thứ tự input |
| D12 | Tiền: **tính bên trong bằng số nguyên satang** (1 THB = 100 satang), output ra THB với tối đa 2 chữ số thập phân | Tránh sai số số thực của JS (`4567 * 0.1 = 456.70000000000005`); 2 chữ số = đơn vị nhỏ nhất của THB (ISO 4217) |
| D13 | Làm tròn: **chỉ làm tròn copay** (half-up), `covered = phần còn lại − copay` | Làm tròn độc lập cả hai có thể lệch tổng 1 satang; cách này giữ bất biến ở mục 5 luôn đúng |
| D14 | Test framework: **`node:test`** (built-in), chạy bằng `node --test` | Không cần dependency, có sẵn từ Node 18 |
| D15 | Kiểm tra **"hạn mức đã cạn"** nằm ở **bước 1**, không phải bước 5 | Nếu để ở bước 5 thì deductible đã bị trừ ở bước 3 trước khi phát hiện DENIED → mâu thuẫn giả định "DENIED không tiêu hao gì" |
| D16 | Ranh giới waiting period: **được chi trả từ ngày `effective_date + N ngày`** trở đi | Ví dụ OPD 30 ngày, hiệu lực 2024-01-01 → chi trả từ 2024-01-31; ngày 2024-01-30 bị từ chối |
| D17 | Bước 1 kiểm tra theo **thứ tự cố định**, trả về lý do của điều kiện **đầu tiên** bị trượt | Kết quả xác định khi một expense trượt nhiều điều kiện |
| D18 | `remaining_visit_limit = null` khi sub-benefit không có `max_visits` | Phân biệt "không giới hạn" với "còn 0 lượt" |
| D19 | Summary hiển thị cả **`remaining`** (số dư riêng của tầng) và **`available`** (= min của tầng đó và các tầng cha) | Tránh hiểu lầm: OPD còn 16,960 nhưng annual tổng = 0 thì thực tế không dùng được |
| D20 | Expense `DENIED`: `not_covered_amount` = toàn bộ số tiền | Giữ bất biến ở mục 5 đúng cho mọi decision |

## 3. Chuỗi xử lý mỗi expense

```
1. Kiểm tra điều kiện → không đạt thì DENIED, dừng luôn (theo đúng thứ tự, D17)
   a. Ngày expense nằm trong [effective_date, expiry_date]?
   b. benefit_type có trong policy?  sub_benefit có trong benefit?
   c. Có dính exclusion?
   d. Đã qua waiting period? (date >= effective_date + waiting_period_days)
   e. Còn lượt khám? (max_visits)
   f. Có tầng hạn mức nào đã cạn (còn 0)? (sub_benefit → benefit → limit_group → policy)
2. Per-visit cap   → eligible = min(amount, per_visit_cap)
                     phần vượt trần → not_covered_amount
3. Deductible      → trừ deductible còn lại của benefit
4. Copay           → PERCENTAGE: % của phần còn lại, làm tròn half-up tới satang
                     FIXED: min(value, phần còn lại)
5. Limit caps      → covered = min(kết quả bước 4, hạn mức còn lại của
                                   sub_benefit, benefit, limit_group, policy)
                     phần bị cắt → not_covered_amount
                     (lý do nêu rõ tầng nào cắt)
```

**Phân biệt 3 loại "limit":**

| Loại | Ví dụ | Có trạng thái? | Bước |
|---|---|---|---|
| Per-visit cap (trần tiền mỗi lần) | 1,500 THB/lần | Không | 2 |
| Visit count limit (số lượt/năm) | 30 lần/năm | Có | 1e |
| Annual limit (tổng tiền/năm, 4 tầng) | Outpatient 20,000/năm | Có | 1f (đã cạn) và 5 (cắt bớt) |

## 4. Decision

| Decision | Điều kiện | Ví dụ lý do |
|---|---|---|
| `DENIED` | Không qua bước 1 | "Excluded under EXC-01 (Cosmetic procedures)." / "Physiotherapy annual limit exhausted." |
| `NO_PAYOUT` | Expense hợp lệ nhưng covered = 0 do deductible và/hoặc copay | "Amount 250 THB is below the fixed copay of 300 THB." / "Deductible 500 THB + copay 200 THB absorbed the full amount." |
| `PARTIALLY_COVERED` | 0 < covered < submitted | "20% copay applied. Covered: 2000 THB. Member copay: 500 THB." |
| `COVERED` | covered = submitted | "Fully covered." |

**Lý do phải cụ thể:** nói rõ tầng nào chặn (ví dụ "hết quỹ chung Dental & Optical", không phải "hết hạn mức Optical"); tách "Not covered under this policy" (sub-benefit không tồn tại) khỏi "Excluded" (dính exclusion).

## 5. Output

**Mỗi expense:**

```json
{
  "expense_id": "EXP-003",
  "submitted_amount": 2500,
  "not_covered_amount": 1000,
  "deductible_applied": 200,
  "copay_amount": 260,
  "covered_amount": 1040,
  "member_pays": 1460,
  "decision": "PARTIALLY_COVERED",
  "reason": "...",
  "remaining_annual_limit": 98960,
  "remaining_visit_limit": 28
}
```

- `remaining_annual_limit`: annual limit **tổng của policy** còn lại sau expense.
- `remaining_visit_limit`: số lượt còn lại của sub-benefit; `null` nếu không giới hạn (D18).

**Bất biến (dùng để test):**
- `submitted_amount = covered_amount + member_pays`
- `member_pays = not_covered_amount + deductible_applied + copay_amount`

**Summary** sau khi xử lý hết expense: theo policy, từng limit group, từng benefit (hạn mức, deductible, `remaining`, `available`) và từng sub-benefit (hạn mức riêng nếu có, lượt khám còn lại) — D19.

## 6. Policy JSON

```json
{
  "policy_id": "POL-2024-001",
  "member_name": "Somchai Jaidee",
  "currency": "THB",
  "effective_date": "2024-01-01",
  "expiry_date": "2024-12-31",
  "annual_limit": 100000,

  "limit_groups": [
    { "group_id": "DENTAL_OPTICAL", "name": "Dental & Optical combined", "annual_limit": 12000 }
  ],

  "benefits": [
    {
      "benefit_type": "OUTPATIENT",
      "annual_limit": 20000,
      "deductible": 1000,
      "copay": { "type": "PERCENTAGE", "value": 20 },
      "waiting_period_days": 30,
      "sub_benefits": [
        { "name": "Doctor Visit",  "per_visit_cap": 1500, "max_visits": 30 },
        { "name": "Physiotherapy", "per_visit_cap": 1500, "max_visits": 10, "annual_limit": 2000 },
        { "name": "Lab Test",      "per_visit_cap": 3000 }
      ]
    },
    {
      "benefit_type": "INPATIENT",
      "annual_limit": 90000,
      "deductible": 0,
      "copay": { "type": "PERCENTAGE", "value": 0 },
      "waiting_period_days": 30,
      "sub_benefits": [
        { "name": "Hospital Stay", "per_visit_cap": 30000 },
        { "name": "Surgery",       "per_visit_cap": 50000 }
      ]
    },
    {
      "benefit_type": "DENTAL",
      "limit_group": "DENTAL_OPTICAL",
      "annual_limit": 10000,
      "deductible": 500,
      "copay": { "type": "FIXED", "value": 300 },
      "waiting_period_days": 90,
      "sub_benefits": [
        { "name": "Cleaning",   "max_visits": 2 },
        { "name": "Filling",    "per_visit_cap": 3000 },
        { "name": "Root Canal", "per_visit_cap": 8000, "waiting_period_days": 180 }
      ]
    },
    {
      "benefit_type": "OPTICAL",
      "limit_group": "DENTAL_OPTICAL",
      "annual_limit": 8000,
      "deductible": 0,
      "copay": { "type": "PERCENTAGE", "value": 10 },
      "waiting_period_days": 60,
      "sub_benefits": [
        { "name": "Eye Exam", "max_visits": 1 },
        { "name": "Glasses",  "per_visit_cap": 5000, "max_visits": 1 }
      ]
    }
  ],

  "exclusions": [
    { "exclusion_id": "EXC-01", "description": "Cosmetic procedures",    "keywords": ["cosmetic", "whitening", "botox", "aesthetic"] },
    { "exclusion_id": "EXC-02", "description": "Self-inflicted injury",  "keywords": ["self-inflicted"] },
    { "exclusion_id": "EXC-03", "description": "Experimental treatment", "keywords": ["experimental"] }
  ]
}
```

**Thay đổi so với bản nháp đầu:** `INPATIENT.annual_limit` 70,000 → **90,000** (để annual tổng có thể cạn); `Physiotherapy.annual_limit` 6,000 → **2,000** (3 expense là thể hiện đủ dùng → cắt → cạn).

**Con số cố ý "chồng" nhau để overlapping thật sự xảy ra:**
- Tổng hạn mức các benefit 20k + 90k + 10k + 8k = 128k > annual limit 100k → tầng policy là tầng chặn (EXP-019, EXP-020).
- Dental 10k + Optical 8k = 18k > quỹ chung 12k → trường hợp (b) (EXP-016, EXP-017).

**Mốc waiting period** (hiệu lực 2024-01-01): OPD/IPD từ **01-31** · Optical từ **03-01** · Dental từ **03-31** · Root Canal từ **06-29**.

**Quy tắc kế thừa:**

| Trường | Khai báo ở | Sub-benefit ghi đè? | Không khai báo nghĩa là |
|---|---|---|---|
| `copay` | benefit | Có | Kế thừa từ benefit |
| `waiting_period_days` | benefit | Có | Kế thừa từ benefit |
| `deductible` | benefit | Không | 0 |
| `per_visit_cap` | sub-benefit | — | Không có trần |
| `max_visits` | sub-benefit | — | Không giới hạn lượt |
| `annual_limit` | cả hai | — | Chỉ bị chặn bởi tầng trên |
| `limit_group` | benefit | — | Không thuộc quỹ chung |

## 7. Bộ 20 expense

**Input** (năm 2024; `provider` bổ sung khi tạo file JSON)

| ID | Ngày | Benefit / Sub-benefit | Chẩn đoán | Số tiền |
|---|---|---|---|---|
| EXP-001 | 01-10 | OUTPATIENT / Doctor Visit | Acute bronchitis | 1,200 |
| EXP-002 | 01-31 | OUTPATIENT / Doctor Visit | Common cold | 800 |
| EXP-003 | 02-12 | OUTPATIENT / Doctor Visit | Acute bronchitis | 2,500 |
| EXP-004 | 02-20 | INPATIENT / Hospital Stay | Dengue fever | 18,500 |
| EXP-005 | 03-05 | OUTPATIENT / Physiotherapy | Lower back pain | 1,500 |
| EXP-006 | 03-19 | OUTPATIENT / Physiotherapy | Lower back pain | 1,500 |
| EXP-007 | 04-02 | OUTPATIENT / Physiotherapy | Lower back pain | 1,500 |
| EXP-008 | 04-03 | DENTAL / Cleaning | Dental plaque | 1,200 |
| EXP-009 | 04-18 | DENTAL / Filling | Dental caries | 4,000 |
| EXP-010 | 05-06 | DENTAL / Cleaning | Routine scaling | 250 |
| EXP-011 | 05-10 | DENTAL / Root Canal | Pulpitis | 7,500 |
| EXP-012 | 06-03 | OUTPATIENT / Acupuncture | Neck pain | 1,500 |
| EXP-013 | 06-20 | INPATIENT / Surgery | Cosmetic rhinoplasty | 45,000 |
| EXP-014 | 07-08 | DENTAL / Cleaning | Dental plaque | 900 |
| EXP-015 | 07-15 | DENTAL / Root Canal | Pulpitis | 7,500 |
| EXP-016 | 08-05 | OPTICAL / Glasses | Myopia | 4,000 |
| EXP-017 | 08-05 | OPTICAL / Eye Exam | Myopia | 800 |
| EXP-018 | 09-10 | INPATIENT / Surgery | Acute appendicitis | 60,000 |
| EXP-019 | 11-20 | INPATIENT / Hospital Stay | Pneumonia | 25,000 |
| EXP-020 | 12-16 | OUTPATIENT / Doctor Visit | Influenza | 1,000 |

**Expected output (tính tay)**

| ID | Not covered | Ded | Copay | Covered | Member | Decision | Annual còn | Lượt còn | Lý do chính |
|---|---|---|---|---|---|---|---|---|---|
| 001 | 1,200 | 0 | 0 | 0 | 1,200 | DENIED | 100,000 | 30 | Waiting period OPD 30 ngày, chi trả từ 01-31 |
| 002 | 0 | 800 | 0 | 0 | 800 | NO_PAYOUT | 100,000 | 29 | Deductible hấp thụ toàn bộ (ded OPD còn 200); rơi đúng ngày 30 |
| 003 | 1,000 | 200 | 260 | 1,040 | 1,460 | PARTIALLY_COVERED | 98,960 | 28 | Trần 1,500/lần + deductible còn lại + copay 20% |
| 004 | 0 | 0 | 0 | 18,500 | 0 | COVERED | 80,460 | null | Chi trả toàn bộ |
| 005 | 0 | 0 | 300 | 1,200 | 300 | PARTIALLY_COVERED | 79,260 | 9 | Copay 20% (HM Physio còn 800) |
| 006 | 400 | 0 | 300 | 800 | 700 | PARTIALLY_COVERED | 78,460 | 8 | HM Physio chỉ còn 800 |
| 007 | 1,500 | 0 | 0 | 0 | 1,500 | DENIED | 78,460 | 8 | HM Physio đã cạn |
| 008 | 0 | 500 | 300 | 400 | 800 | PARTIALLY_COVERED | 78,060 | 1 | Deductible Dental + copay cố định 300 |
| 009 | 1,000 | 0 | 300 | 2,700 | 1,300 | PARTIALLY_COVERED | 75,360 | null | Trần Filling 3,000 + copay cố định |
| 010 | 0 | 0 | 250 | 0 | 250 | NO_PAYOUT | 75,360 | 0 | 250 thấp hơn copay cố định 300 |
| 011 | 7,500 | 0 | 0 | 0 | 7,500 | DENIED | 75,360 | null | Waiting period Root Canal 180 ngày, chi trả từ 06-29 |
| 012 | 1,500 | 0 | 0 | 0 | 1,500 | DENIED | 75,360 | null | Acupuncture không có trong policy |
| 013 | 45,000 | 0 | 0 | 0 | 45,000 | DENIED | 75,360 | null | Exclusion EXC-01 (Cosmetic) |
| 014 | 900 | 0 | 0 | 0 | 900 | DENIED | 75,360 | 0 | Đã dùng hết 2/2 lượt Cleaning |
| 015 | 300 | 0 | 300 | 6,900 | 600 | PARTIALLY_COVERED | 68,460 | null | HM Dental chỉ còn 6,900 (tầng benefit) |
| 016 | 1,600 | 0 | 400 | 2,000 | 2,000 | PARTIALLY_COVERED | 66,460 | 0 | Quỹ chung Dental & Optical chỉ còn 2,000 |
| 017 | 800 | 0 | 0 | 0 | 800 | DENIED | 66,460 | 1 | Quỹ chung đã cạn (Optical vẫn còn 6,000 và 1 lượt) |
| 018 | 10,000 | 0 | 0 | 50,000 | 10,000 | PARTIALLY_COVERED | 16,460 | null | Trần Surgery 50,000/lần |
| 019 | 8,540 | 0 | 0 | 16,460 | 8,540 | PARTIALLY_COVERED | 0 | null | Annual limit tổng chỉ còn 16,460 |
| 020 | 1,000 | 0 | 0 | 0 | 1,000 | DENIED | 0 | 28 | Annual limit tổng đã cạn (OPD vẫn còn 16,960) |

Mọi hàng thỏa bất biến ở mục 5. Tổng covered cả năm = 100,000 = annual limit.

**Chú ý:**
- EXP-011 và EXP-015: cùng ca Root Canal, bị từ chối tháng 5 (waiting period), được trả tháng 7.
- EXP-016 và EXP-017: cùng ngày, thứ tự theo ID quyết định kết quả (nếu Eye Exam xử lý trước sẽ được trả 720, Glasses chỉ còn 1,280).
- EXP-003 là expense mẫu trong đề, nhưng kết quả khác vì policy có trần và deductible. Output mẫu của đề chỉ minh họa định dạng → ghi rõ trong README.

**Summary cuối năm (tính tay)**

| Tầng | Hạn mức | Đã dùng | `remaining` | `available` | Ghi chú |
|---|---|---|---|---|---|
| Policy (annual) | 100,000 | 100,000 | 0 | 0 | |
| Group DENTAL_OPTICAL | 12,000 | 12,000 | 0 | 0 | |
| OUTPATIENT | 20,000 | 3,040 | 16,960 | 0 | Deductible 1,000/1,000 đã dùng |
| · Doctor Visit | — | — | — | — | Lượt: 28/30 còn |
| · Physiotherapy | 2,000 | 2,000 | 0 | 0 | Lượt: 8/10 còn |
| · Lab Test | — | 0 | — | — | Chưa dùng |
| INPATIENT | 90,000 | 84,960 | 5,040 | 0 | |
| DENTAL | 10,000 | 10,000 | 0 | 0 | Deductible 500/500 đã dùng · Cleaning 0/2 lượt còn |
| OPTICAL | 8,000 | 2,000 | 6,000 | 0 | Glasses 0/1 · Eye Exam 1/1 lượt còn |

**Bảng phủ kịch bản**

| Kịch bản | Expense |
|---|---|
| Chi trả trọn vẹn | 004 |
| Chi trả một phần do copay (% / cố định) | 005 / 008, 009 |
| DENIED — waiting period (tầng benefit / ghi đè ở sub-benefit) | 001 / 011 |
| DENIED — exclusion | 013 |
| DENIED — hết hạn mức (sub-benefit / quỹ chung / annual) | 007 / 017 / 020 |
| Chi trả một phần — hạn mức còn lại < chi phí (sub / benefit / quỹ chung / annual) | 006 / 015 / 016 / 019 |
| Per-visit cap | 003, 009, 018 |
| Deductible (trả hết / trả một phần) | 002 / 003, 008 |
| NO_PAYOUT (do deductible / do copay cố định) | 002 / 010 |
| Hết lượt khám · Sub-benefit không tồn tại | 014 · 012 |
| Rơi đúng ranh giới waiting period · Cùng ngày | 002 · 016–017 |
| Nhiều expense cùng tiêu hao một hạn mức | 002–003 (deductible), 005–007 (Physio), 008–017 (quỹ chung), toàn bộ (annual) |

**Không có trong 20 expense → phủ bằng unit test:** expense ngoài thời hạn policy, benefit_type không tồn tại, làm tròn số lẻ satang, input không theo thứ tự ngày.

## 8. Giả định & ngoài phạm vi

1. Lượt khám chỉ bị trừ khi decision khác `DENIED` (`NO_PAYOUT` vẫn bị trừ lượt).
2. Expense `DENIED` và phần vượt trần không tiêu hao hạn mức, deductible hay lượt khám.
3. Waiting period tính từ `effective_date` của policy (D16).
4. **Không miễn waiting period cho tai nạn.** Thực tế thường miễn; muốn hỗ trợ cần thêm field `is_accident` vào expense.
5. So khớp keyword cho exclusion có thể bắt nhầm ("Non-cosmetic scar revision") hoặc bỏ sót ("Rhinoplasty").
6. Sub-benefit không có trong policy → `DENIED` với lý do "Not covered under this policy" (khác với "Excluded").
7. Copay tính trước khi áp hạn mức (bước 4 trước bước 5): khi hạn mức cắt bớt, copay giữ nguyên và phần bị cắt vào `not_covered_amount`.

## 9. Câu hỏi còn mở

- [x] Ngôn ngữ → JavaScript (D10)
- [x] Nhiều expense cùng ngày → theo `date`, rồi `expense_id` (D11)
- [x] Làm tròn → satang nội bộ, chỉ làm tròn copay half-up (D12, D13)
- [x] Test framework → `node:test` (D14)
- [x] Thiết kế 20 expense phủ đủ kịch bản (mục 7)
- [ ] Kiến trúc module & unit test
- [ ] Ước lượng timeline
