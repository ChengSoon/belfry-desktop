let nextId = 0;
export async function mcpRequest(session, message) {
  const request = { jsonrpc: "2.0", id: ++nextId, ...message };
  const response = await fetch(session.url, { method: "POST", headers: {
    Authorization: `Bearer ${session.token}`, "Content-Type": "application/json",
  }, body: JSON.stringify(request) });
  return { status: response.status, data: response.status === 202 ? null : await response.json() };
}
