module.exports = ({ config }) => {
  const appleTeamId = process.env.EXPO_APPLE_TEAM_ID || process.env.APPLE_TEAM_ID;

  return {
    ...config,
    ios: {
      ...config.ios,
      ...(appleTeamId ? { appleTeamId } : {}),
    },
  };
};
