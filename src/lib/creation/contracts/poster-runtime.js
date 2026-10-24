export const POSTER_IMAGE_PIPELINE_VERSION = 1;
export const POSTER_IMAGE_SCHEDULER_HEARTBEAT = "creation-poster-image-scheduler-v1";
export const POSTER_IMAGE_LANGUAGE_HEARTBEAT = "creation-poster-image-language-v1";

export function posterImageWorkersReady(rows) {
  return [POSTER_IMAGE_SCHEDULER_HEARTBEAT, POSTER_IMAGE_LANGUAGE_HEARTBEAT].every(id =>
    rows.some(row => row.id === id && row.details?.version === POSTER_IMAGE_PIPELINE_VERSION));
}
