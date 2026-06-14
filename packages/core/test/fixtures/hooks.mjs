// Example hooks module (the code escape-hatch) used by tests.
export const transforms = {
  shout: (value) => `${String(value).toUpperCase()}!`,
};

export const postProcess = {
  first: (data) => (Array.isArray(data) ? data.slice(0, 1) : data),
};
