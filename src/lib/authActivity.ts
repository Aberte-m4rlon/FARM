export async function recordAuthenticationActivity(
  accessToken: string,
  action: 'login' | 'logout',
): Promise<void> {
  try {
    const response = await fetch('/api/activity/auth', {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      console.warn(`Could not record ${action} activity (HTTP ${response.status}).`);
    }
  } catch {
    console.warn(`Could not reach the activity service to record ${action}.`);
  }
}
