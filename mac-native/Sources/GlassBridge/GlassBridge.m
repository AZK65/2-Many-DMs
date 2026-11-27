#import "GlassBridge.h"

BOOL TMDHasLiquidGlass(void) {
    if (@available(macOS 26.0, *)) return NSClassFromString(@"NSGlassEffectView") != Nil;
    return NO;
}

NSView *TMDGlassView(CGFloat radius) {
    // The documented AppKit class is resolved at runtime so the native client
    // also builds with older command-line SDKs. No private API or emulated blur.
    if (TMDHasLiquidGlass() && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency) {
        Class glassClass = NSClassFromString(@"NSGlassEffectView");
        NSView *view = [[glassClass alloc] initWithFrame:NSZeroRect];
        if ([view respondsToSelector:NSSelectorFromString(@"setCornerRadius:")]) {
            [view setValue:@(radius) forKey:@"cornerRadius"];
        }
        return view;
    }
    NSVisualEffectView *view = [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
    view.material = NSVisualEffectMaterialSidebar;
    view.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    view.state = NSVisualEffectStateFollowsWindowActiveState;
    view.wantsLayer = YES;
    view.layer.cornerRadius = radius;
    view.layer.masksToBounds = YES;
    return view;
}
