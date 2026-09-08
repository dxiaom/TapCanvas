import DypnsapiClient from "@alicloud/dypnsapi20170525";
import {
	CheckSmsVerifyCodeRequest,
	SendSmsVerifyCodeRequest,
} from "@alicloud/dypnsapi20170525";
import { Config as $OpenApiConfig } from "@alicloud/openapi-core/dist/utils";
import { RuntimeOptions } from "@darabonba/typescript";

// 阿里云官方文档：SendSmsVerifyCode 的 SchemeName 为可选，不填则使用"默认方案"。
export type AliyunSmsAuthConfig = {
	accessKeyId: string;
	accessKeySecret: string;
	schemeName: string | null;
	signName: string;
	templateCode: string;
};

export function isAliyunSmsAuthConfigured(config: {
	aliyunSmsAccessKeyId: string | null;
	aliyunSmsAccessKeySecret: string | null;
	aliyunSmsSignName: string | null;
	aliyunSmsTemplateCode: string | null;
}): boolean {
	return Boolean(
		config.aliyunSmsAccessKeyId &&
			config.aliyunSmsAccessKeySecret &&
			config.aliyunSmsSignName &&
			config.aliyunSmsTemplateCode,
	);
}

function createDypnsapiClient(config: AliyunSmsAuthConfig): DypnsapiClient {
	return new DypnsapiClient(
		new $OpenApiConfig({
			accessKeyId: config.accessKeyId,
			accessKeySecret: config.accessKeySecret,
			endpoint: "dypnsapi.aliyuncs.com",
		}),
	);
}

function createRuntime(): RuntimeOptions {
	return new RuntimeOptions({});
}

/**
 * 从阿里云 SDK 抛出的异常中提取 Code/Message（异常结构：{ code, message, statusCode, data: { Code, Message } }）。
 * 避免调用方只能拿到笼统的 500，确保错误信息显式暴露。
 */
function extractApiError(error: unknown): { code: string; message: string } {
	const data = error && typeof error === "object" ? (error as { data?: unknown }).data : null;
	const dataCode =
		data && typeof data === "object" && typeof (data as { Code?: unknown }).Code === "string"
			? (data as { Code: string }).Code
			: "";
	const dataMessage =
		data && typeof data === "object" && typeof (data as { Message?: unknown }).Message === "string"
			? (data as { Message: string }).Message
			: "";
	const code =
		typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
			? (error as { code: string }).code
			: "";
	const message =
		typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
			? (error as { message: string }).message
			: "";
	return {
		code: code || dataCode,
		message: message || dataMessage || (error instanceof Error ? error.message : String(error)),
	};
}

export type SendSmsVerifyCodeResult = {
	ok: boolean;
	requestId: string;
	code: string;
	message: string;
	devCode?: string;
};

/**
 * 发送短信验证码（阿里云短信认证服务 SendSmsVerifyCode）。
 * 验证码由阿里云动态生成并核验，本服务不落库验证码明文。
 * returnVerifyCode=true 仅在调试场景（本地/测试）下把验证码随响应返回。
 */
export async function sendSmsVerifyCode(options: {
	config: AliyunSmsAuthConfig;
	phoneNumber: string;
	countryCode?: string;
	validTimeSeconds?: number;
	codeLength?: number;
	outId?: string;
	returnVerifyCode?: boolean;
}): Promise<SendSmsVerifyCodeResult> {
	const {
		config,
		phoneNumber,
		countryCode = "86",
		validTimeSeconds = 300,
		codeLength = 6,
		outId,
		returnVerifyCode = false,
	} = options;

	const client = createDypnsapiClient(config);
	const request = new SendSmsVerifyCodeRequest({
		phoneNumber,
		countryCode,
		...(config.schemeName ? { schemeName: config.schemeName } : {}),
		signName: config.signName,
		templateCode: config.templateCode,
		// 与官方文档示例完全一致：{"code":"##code##","min":"5"}
		templateParam: JSON.stringify({
			code: "##code##",
			min: String(Math.max(1, Math.round(validTimeSeconds / 60))),
		}),
		// 官方文档：TemplateParam 使用 ##code## 占位符时 CodeType 必填（1=纯数字）
		codeType: 1,
		codeLength,
		...(returnVerifyCode ? { returnVerifyCode: true } : {}),
		...(outId ? { outId } : {}),
	});

	let response: Awaited<ReturnType<typeof client.sendSmsVerifyCodeWithOptions>>;
	try {
		response = await client.sendSmsVerifyCodeWithOptions(request, createRuntime());
	} catch (error) {
		const apiError = extractApiError(error);
		console.error("[auth/sms] sendSmsVerifyCode failed", { code: apiError.code, message: apiError.message });
		return {
			ok: false,
			requestId: "",
			code: apiError.code,
			message: apiError.message || "验证码发送失败",
		};
	}

	const body = response.body;
	const requestId = String(body?.requestId || "");
	const ok = response.statusCode === 200 && String(body?.code || "") === "OK";
	if (!ok) {
		console.error("[auth/sms] sendSmsVerifyCode api error", {
			statusCode: response.statusCode,
			body: JSON.stringify(body ?? null),
		});
	}
	return {
		ok,
		requestId,
		code: String(body?.code || ""),
		message: String(body?.message || ""),
		...(returnVerifyCode && body?.model?.verifyCode ? { devCode: body.model.verifyCode } : {}),
	};
}

export type CheckSmsVerifyCodeResult = {
	ok: boolean;
	verified: boolean;
	requestId: string;
	code: string;
	message: string;
};

/**
 * 核验短信验证码（阿里云短信认证服务 CheckSmsVerifyCode）。
 * 只有 body.Model.VerifyResult === "PASS" 才算核验通过。
 */
export async function checkSmsVerifyCode(options: {
	config: AliyunSmsAuthConfig;
	phoneNumber: string;
	verifyCode: string;
	countryCode?: string;
	outId?: string;
}): Promise<CheckSmsVerifyCodeResult> {
	const { config, phoneNumber, verifyCode, countryCode = "86", outId } = options;

	const client = createDypnsapiClient(config);
	const request = new CheckSmsVerifyCodeRequest({
		phoneNumber,
		countryCode,
		...(config.schemeName ? { schemeName: config.schemeName } : {}),
		verifyCode,
		caseAuthPolicy: 1,
		...(outId ? { outId } : {}),
	});

	let response: Awaited<ReturnType<typeof client.checkSmsVerifyCodeWithOptions>>;
	try {
		response = await client.checkSmsVerifyCodeWithOptions(request, createRuntime());
	} catch (error) {
		const apiError = extractApiError(error);
		console.error("[auth/sms] checkSmsVerifyCode failed", { code: apiError.code, message: apiError.message });
		return {
			ok: false,
			verified: false,
			requestId: "",
			code: apiError.code,
			message: apiError.message || "验证码核验失败",
		};
	}

	const body = response.body;
	const requestId = String(body?.requestId || "");
	const apiOk = response.statusCode === 200 && String(body?.code || "") === "OK";
	const verified = apiOk && String(body?.model?.verifyResult || "") === "PASS";
	return {
		ok: apiOk,
		verified,
		requestId,
		code: String(body?.code || ""),
		message: String(body?.message || ""),
	};
}
