type Case = {
  url: string;
  intructions: string;
  expectedResult: string;
};
export const cases = [
  {
    url: "wikipedia.org",
    intructions:
      "Navigate to wikipedia and search and retrive the year when ww1 was started.",
    expectedResult: "It started year 1914",
  },
];
