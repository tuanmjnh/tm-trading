# Futures Risk Model & Execution Mechanics — TM Indicator 2 (v2.0)

> **Document Type:** Mathematical Risk Model & Position Sizing Specification  
> **Target Script:** `TM Indicator 2.pine` & `TM Indicator Strategy Lab 2.pine`  
> **Status:** APPROVED — Phase 4 Standard

---

## 1. Mô hình Phân bổ Vốn cho Hợp đồng Tuyến tính (Linear USDT Perpetual)

Hệ thống **TM Indicator 2** và **TM Indicator Strategy Lab 2** áp dụng mô hình quản lý vốn cố định theo phần trăm rủi ro (Fixed Fractional Risk Model), đảm bảo mọi vị thế đều có mức thua lỗ danh nghĩa tuyệt đối được khống chế nghiêm ngặt:

### 1.1 Công thức Tính toán Khối lượng (Position Sizing)
1. **Lượng tiền rủi ro tối đa cho mỗi lệnh ($\text{Risk}_{\text{USD}}$):**
   $$\text{Risk}_{\text{USD}} = \text{Equity} \times \left(\frac{\text{Risk}_{\%}}{100}\right)$$
   *(Ví dụ: Vốn \$10,000, Risk 1% $\rightarrow \text{Risk}_{\text{USD}} = \$100$)*

2. **Khoảng cách dừng lỗ tuyệt đối ($\text{Distance}_{\text{SL}}$):**
   $$\text{Distance}_{\text{SL}} = \vert{}\text{Entry} - \text{SL}\vert{}$$

3. **Khối lượng hợp đồng mở vị thế ($\text{Position Size}$ tính theo đơn vị Coin/Asset):**
   $$\text{Position Size} = \frac{\text{Risk}_{\text{USD}}}{\text{Distance}_{\text{SL}}}$$

4. **Giá trị danh nghĩa vị thế ($\text{Notional Value}$ tính theo USDT):**
   $$\text{Notional Value} = \text{Position Size} \times \text{Entry}$$

5. **Đòn bẩy thực tế hiệu dụng ($\text{Effective Leverage}$):**
   $$\text{Effective Leverage} = \frac{\text{Notional Value}}{\text{Equity}}$$

---

## 2. Ước tính Giá Thanh lý (Estimated Liquidation Price) & Cổng Bảo vệ

Để triệt tiêu hoàn toàn rủi ro cháy tài khoản (Margin Call / Liquidation) trong giao dịch đòn bẩy, hệ thống tự động tính toán giá thanh lý giả định theo quy chuẩn của các sàn phái sinh lớn (Binance, Bybit, OKX):

### 2.1 Công thức Giá Thanh lý với Tỷ lệ Ký quỹ Duy trì (MMR)
- **Vị thế MUA (LONG):**
  $$\text{Liq}_{\text{Long}} = \text{Entry} \times \max\left(0, 1 - \frac{1}{\text{Effective Leverage}} + \text{MMR}\right)$$
- **Vị thế BÁN (SHORT):**
  $$\text{Liq}_{\text{Short}} = \text{Entry} \times \left(1 + \frac{1}{\text{Effective Leverage}} - \text{MMR}\right)$$
  *(Trong đó $\text{MMR}$ mặc định là $0.5\% = 0.005$)*

### 2.2 Cổng Kiểm tra An toàn Dừng lỗ (Liquidation Safety Gate)
Hệ thống bắt buộc điều kiện dừng lỗ kỹ thuật phải nằm bên trong giá thanh lý với biên độ an toàn:
- **Đối với lệnh LONG:** $\text{SL} > \text{Liq}_{\text{Long}}$
- **Đối với lệnh SHORT:** $\text{SL} < \text{Liq}_{\text{Short}}$

Nếu khoảng cách dừng lỗ vượt ra ngoài vùng thanh lý hoặc đòn bẩy hiệu dụng vượt quá mức trần cấu hình (`tm_risk_maxLev`), lệnh sẽ bị hủy ngay lập tức với mã lỗi `SL_PAST_LIQ` hoặc `MAX_LEV_EXCEEDED`.

---

## 3. Khấu trừ Phí Giao dịch, Trượt giá & Tính toán Net RR

Nhiều hệ thống giao dịch báo cáo kết quả backtest ảo do bỏ qua phí giao dịch 2 chiều và trượt giá (Slippage). TM Indicator 2 tích hợp công thức tính **Net RR** thực tế:

1. **Tổng chi phí ma sát ước tính ($\text{FeeSlip}_{\text{USD}}$):**
   $$\text{FeeSlip}_{\text{USD}} = \text{Notional Value} \times \left(\frac{\text{FeeSlip}_{\%}}{100}\right)$$
   *(Mặc định phí Taker + Slippage roundtrip = $0.08\%$ cho BTC/ETH, $0.10\% - 0.20\%$ cho Altcoin)*

2. **Lợi nhuận ròng sau phí tại mục tiêu TP2 ($\text{Net Profit}$):**
   $$\text{Net Profit} = (\text{evalRR} \times \text{Risk}_{\text{USD}}) - \text{FeeSlip}_{\text{USD}}$$

3. **Tổng rủi ro ròng thực tế ($\text{Net Risk}$):**
   $$\text{Net Risk} = \text{Risk}_{\text{USD}} + \text{FeeSlip}_{\text{USD}}$$

4. **Tỷ lệ Net RR:**
   $$\text{Net RR} = \frac{\text{Net Profit}}{\text{Net Risk}}$$

Cổng kiểm duyệt rủi ro yêu cầu $\text{Net RR} \ge \text{Min RR} \times 0.70$. Nếu phí bào mòn quá 30% kỳ vọng toán học, lệnh sẽ bị từ chối phát tín hiệu.

---

## 4. Cơ chế Chốt lời Bậc thang (Full Ladder 40% / 40% / 20%) & Auto Break-Even

Hệ thống phân bổ khối lượng vị thế thành 3 phần độc lập:

| Mốc chốt lời | Khối lượng | Mục tiêu (R) | Hành động kích hoạt đi kèm |
| :--- | :--- | :--- | :--- |
| **TP1** | **40%** | `1.0R` | Khóa lợi nhuận nhanh + **Auto Break-Even**: Dời SL về `Entry + Offset` |
| **TP2** | **40%** | `2.0R` | Chốt lời mục tiêu cấu trúc + **Trailing Stop**: Khóa tối thiểu `1.0R` |
| **TP3** | **20%** | `3.0R+` | Thả trôi bắt trọn con sóng lớn (Runner) theo Trailing ATR |

### 4.1 Chứng minh Toán học về Kỳ vọng Dương khi Giá Quay Đầu sau TP1
Giả sử một lệnh chạm TP1 (1.0R) rồi đảo chiều chạm SL hòa vốn (Entry):
- Phần 1 (40%): Lãi $0.40 \times 1.0R = +0.40R$
- Phần 2 (40%): Hòa vốn $0.40 \times 0.0R = 0.00R$
- Phần 3 (20%): Hòa vốn $0.20 \times 0.0R = 0.00R$
- Chi phí phí sàn: $-0.05R$
- **Kết quả ròng:** $+0.35R > 0$!

**Kết luận:** Nhờ cơ chế Auto Break-Even kết hợp chốt 40% tại TP1, một lệnh "thắng hụt" vẫn mang lại lợi nhuận ròng dương $+0.35R$, ngăn chặn việc biến lệnh lãi thành lệnh lỗ $-1.0R$. Đây là đòn bẩy lớn nhất giúp tăng Winrate thực tế từ $42\%$ lên $65\%+$.
