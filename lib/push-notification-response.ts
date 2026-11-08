interface PushNotificationResponse {
  error?: string;
  details?: string;
  code?: string;
  sent?: number;
  failed?: number;
  duplicate?: boolean;
}

export async function readPushNotificationResponse(
  response: Response
): Promise<PushNotificationResponse> {
  const body = await response.text();
  let result: PushNotificationResponse = {};

  if (body.trim()) {
    try {
      result = JSON.parse(body) as PushNotificationResponse;
    } catch {
      throw new Error(
        `Push endpoint returned an invalid response (HTTP ${response.status} ${response.statusText}).`
      );
    }
  } else {
    throw new Error(
      `Push endpoint returned an empty response (HTTP ${response.status} ${response.statusText}).`
    );
  }

  if (!response.ok) {
    const diagnostic = [result.code, result.details].filter(Boolean).join(': ');
    const deliveryResult = typeof result.sent === 'number'
      ? ` ${result.sent} sent, ${result.failed ?? 0} failed.`
      : '';
    throw new Error(
      `${result.error || `Push endpoint failed (HTTP ${response.status}).`}${diagnostic ? ` ${diagnostic}` : ''}${deliveryResult}`
    );
  }

  return result;
}
