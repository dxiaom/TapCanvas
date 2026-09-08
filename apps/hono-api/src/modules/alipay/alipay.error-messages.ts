// 支付宝开放平台错误码 → 面向用户的中文提示。
// 这是确定性的错误码翻译表（非语义判断）；原始 code/sub_code/sub_msg 始终保留在
// AppError.details 与服务端日志里，便于运维按官方文档排查。

const SUB_CODE_MESSAGES: Readonly<Record<string, string>> = {
	// 网关 / 通用（isv.*、aop.*）
	"isv.invalid-signature": "支付宝签名校验失败，请检查应用私钥与支付宝公钥配置",
	"isv.missing-signature": "支付宝请求缺少签名参数",
	"isv.invalid-sign-type": "支付宝签名类型不支持，需使用 RSA2",
	"isv.invalid-app-id": "支付宝应用不存在或已下线（APPID 无效）",
	"isv.parameters-missing": "支付宝请求参数缺失",
	"isv.invalid-argument": "支付宝请求参数无效",
	"isv.missing-method": "支付宝请求缺少 method 参数",
	"isv.invalid-format-type": "支付宝报文格式不支持",
	"isv.invalid-charset-type": "支付宝编码格式不支持",
	"isv.permission-not-open": "该支付宝产品未签约或签约未生效",
	"isv.TEMP_UNAVAILABLE": "支付宝接口暂时不可用，请稍后重试",
	"aop.SYSTEM_ERROR": "支付宝系统繁忙，请稍后重试",
	"aop.ACQ.SYSTEM_ERROR": "支付宝系统繁忙，请稍后重试",
	"aop.ACQ.ACCESS_FORBIDDEN": "支付宝接口访问被拒绝，请检查产品签约状态",
	"aop.ACQ.ACCESS_EXCEEDED": "支付宝接口调用超限，请稍后重试",
	"aop.ACQ.TRIGGER_REJECT": "支付宝接口调用被限流，请稍后重试",
	"aop.invalid-app-auth-token": "支付宝应用授权无效",
	"aop.unknow-error": "支付宝未知错误，请稍后重试",

	// 交易 / 业务（ACQ.*）
	"ACQ.TRADE_NOT_EXIST": "交易不存在（用户尚未扫码付款）",
	"ACQ.TRADE_HAS_SUCCESS": "该订单已支付成功，请勿重复支付",
	"ACQ.TRADE_HAS_CLOSED": "该笔交易已关闭，请重新发起支付",
	"ACQ.TRADE_FINISHED": "该笔交易已结束",
	"ACQ.TRADE_STATUS_ERROR": "当前交易状态不允许此操作",
	"ACQ.MERCHANT_NOT_SIGN_TO_PRODUCT": "商户未签约对应支付宝产品或签约未生效",
	"ACQ.MERCHANT_PRODUCT_NOT_SIGN": "商户未签约对应支付宝产品或签约未生效",
	"ACQ.MERCHANT_STATUS_ERROR": "支付宝商户状态异常，请联系支付宝客服",
	"ACQ.MERCHANT_BALANCE_NOT_ENOUGH": "商户支付宝余额不足",
	"ACQ.AMOUNT_EXCEED_PRODUCT_LIMIT": "超过该支付宝产品的单笔金额限制",
	"ACQ.EXCEED_LIMIT_BARCODE": "超过支付宝付款限额",
	"ACQ.EXCEED_LIMIT_BALANCE": "超过支付宝余额支付限额",
	"ACQ.EXCEED_LIMIT_BANKCARD": "超过银行卡支付限额",
	"ACQ.BUYER_PAYMENT_AMOUNT_DAY_LIMIT_EXCEEDED": "买家当日付款额度已用完",
	"ACQ.BUYER_BALANCE_NOT_ENOUGH": "买家支付宝余额不足",
	"ACQ.BUYER_BANKCARD_NOT_ENOUGH": "买家银行卡余额不足",
	"ACQ.ERROR_BUYER_VALIDATE_FAIL": "买家身份校验失败",
	"ACQ.TRADE_BUYER_NOT_MATCH": "付款账户与下单账户不一致",
	"ACQ.CURRENCY_NOT_SUPPORT": "暂不支持该币种",
	"ACQ.INVALID_PARAMETER": "支付宝请求参数错误",
	"ACQ.TRADE_DATA_ERROR": "支付宝交易数据异常",
	"ACQ.SELLER_BALANCE_NOT_ENOUGH": "卖家支付宝余额不足",
	"ACQ.TRADE_NOT_ALLOW_REFUND": "该交易不支持退款",
	"ACQ.REFUND_AMT_INEQUALITY": "退款金额与交易金额不一致",
};

export function describeAlipaySubCode(subCode: string): string | null {
	return SUB_CODE_MESSAGES[subCode] ?? null;
}

function containsChinese(text: string): boolean {
	return /[\u4e00-\u9fa5]/.test(text);
}

// 组装面向用户的中文错误消息：sub_code 精确映射优先；sub_msg 本身是中文时透传；
// 否则回退为"通用文案 + 原始错误码"，保证体验与可诊断性兼得。
export function buildAlipayUserMessage(input: {
	action: string;
	code: string;
	subCode: string;
	subMsg: string;
}): string {
	const mapped = input.subCode ? describeAlipaySubCode(input.subCode) : null;
	if (mapped) return `支付宝${input.action}失败：${mapped}`;
	if (input.subMsg && containsChinese(input.subMsg)) {
		return `支付宝${input.action}失败：${input.subMsg}`;
	}
	const raw = [input.subCode, input.subMsg].filter(Boolean).join(" ");
	return raw
		? `支付宝${input.action}失败（${input.code || "未知错误码"} ${raw}）`
		: `支付宝${input.action}失败`;
}
