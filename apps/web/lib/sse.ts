export type SseMessage = {
  event: string;
  data: string;
};

export async function readSseStream(
  response: Response,
  onMessage: (message: SseMessage) => void,
) {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error('Response body is not readable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = emitCompleteMessages(buffer, onMessage);
  }

  buffer += decoder.decode();

  if (buffer.trim().length > 0) {
    parseMessage(buffer, onMessage);
  }
}

function emitCompleteMessages(
  buffer: string,
  onMessage: (message: SseMessage) => void,
) {
  let remaining = buffer;
  let boundary = remaining.search(/\r?\n\r?\n/);

  while (boundary !== -1) {
    const rawMessage = remaining.slice(0, boundary);
    const match = remaining.match(/\r?\n\r?\n/);
    const delimiterLength = match?.[0].length ?? 2;

    parseMessage(rawMessage, onMessage);
    remaining = remaining.slice(boundary + delimiterLength);
    boundary = remaining.search(/\r?\n\r?\n/);
  }

  return remaining;
}

function parseMessage(
  rawMessage: string,
  onMessage: (message: SseMessage) => void,
) {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of rawMessage.split(/\r?\n/)) {
    if (line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return;
  }

  onMessage({
    event,
    data: dataLines.join('\n'),
  });
}
