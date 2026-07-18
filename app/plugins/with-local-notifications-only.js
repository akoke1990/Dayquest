// Config plugin: LOCAL notifications only — strip the remote-push entitlement.
//
// expo-notifications' plugin adds `aps-environment` (Apple remote push / APNs)
// to the iOS entitlements. DayQuest only schedules LOCAL notifications (the
// Weekend Hunt day-of reminder), which need no APNs entitlement — but Xcode
// hard-fails when the entitlement is present and the provisioning profile
// lacks the Push Notifications capability (which ours does; adding it needs an
// interactive Apple login). Deleting the entitlement here keeps cloud builds
// green with the existing profile. If real remote push ever lands, remove this
// plugin and regenerate credentials with the capability instead.
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });
};
