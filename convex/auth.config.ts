declare const process: {
  env: {
    AVE_CLIENT_ID?: string;
  };
};

export default {
  providers: [
    {
      domain: "https://aveid.net",
      applicationID: process.env.AVE_CLIENT_ID!,
    },
  ],
};
