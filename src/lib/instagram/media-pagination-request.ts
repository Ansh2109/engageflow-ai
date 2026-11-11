export type MediaPaginationRequest = {
  generation: number;
  controller: AbortController;
};

export class MediaPaginationRequestGuard {
  private generation = 0;
  private activeRequest: MediaPaginationRequest | null = null;

  begin(): MediaPaginationRequest | null {
    if (this.activeRequest) return null;

    const request = {
      generation: this.generation,
      controller: new AbortController(),
    };
    this.activeRequest = request;
    return request;
  }

  isCurrent(request: MediaPaginationRequest): boolean {
    return (
      this.activeRequest === request &&
      request.generation === this.generation &&
      !request.controller.signal.aborted
    );
  }

  finish(request: MediaPaginationRequest): boolean {
    if (!this.isCurrent(request)) return false;
    this.activeRequest = null;
    return true;
  }

  reset(): void {
    this.generation += 1;
    this.activeRequest?.controller.abort();
    this.activeRequest = null;
  }
}
