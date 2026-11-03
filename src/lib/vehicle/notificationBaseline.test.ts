import { describe, expect, it } from 'vitest';
import { advanceNotificationBaseline, notificationBaseline } from './notificationBaseline';
import type { NotificationState } from './model';

const note={id:'note-1',occurrence:'doc:mandatory:2026-11-09:week'};
const row:NotificationState={...note,schemaVersion:1,version:1,read:true,archived:false,snoozeUntilDay:null};

describe('notification baseline before a versioned write',()=>{
  it('does not turn an uninitialized or empty cached collection into a create',()=>{
    const lifetime={};
    expect(notificationBaseline(lifetime,undefined,false,note)).toEqual({kind:'unavailable'});
    const cached=advanceNotificationBaseline(undefined,lifetime,[],[],false);
    expect(notificationBaseline(lifetime,cached,false,note)).toEqual({kind:'unavailable'});
  });

  it('uses the actual existing cached version and image without waiting for a server snapshot',()=>{
    const lifetime={},cached=advanceNotificationBaseline(undefined,lifetime,[row],[row.id],false);
    const result=notificationBaseline(lifetime,cached,false,note);
    expect(result).toEqual({kind:'existing',before:row});
    if(result.kind==='existing')expect(result.before).toBe(row);
  });

  it('permits a genuinely absent occurrence after a complete server baseline',()=>{
    const lifetime={},confirmed=advanceNotificationBaseline(undefined,lifetime,[],[],true);
    expect(notificationBaseline(lifetime,confirmed,false,note)).toEqual({kind:'absent'});
  });

  it('retains confirmed absence for new offline occurrences in the same lifetime',()=>{
    const lifetime={},confirmed=advanceNotificationBaseline(undefined,lifetime,[row],[row.id],true);
    const offline=advanceNotificationBaseline(confirmed,lifetime,[row],[row.id],false);
    expect(notificationBaseline(lifetime,offline,false,{id:'new-note',occurrence:'new'})).toEqual({kind:'absent'});
    expect(notificationBaseline(lifetime,offline,false,note)).toEqual({kind:'existing',before:row});
  });

  it('does not recreate a previously confirmed document missing from a later cache snapshot',()=>{
    const lifetime={},confirmed=advanceNotificationBaseline(undefined,lifetime,[row],[row.id],true);
    const incomplete=advanceNotificationBaseline(confirmed,lifetime,[],[],false);
    expect(notificationBaseline(lifetime,incomplete,false,note)).toEqual({kind:'unavailable'});
    const deletion=advanceNotificationBaseline(incomplete,lifetime,[],[],true);
    expect(notificationBaseline(lifetime,deletion,false,note)).toEqual({kind:'absent'});
  });

  it('retains malformed raw identities without blocking unrelated verified targets',()=>{
    const lifetime={},malformed=advanceNotificationBaseline(undefined,lifetime,[],[note.id],true);
    expect(notificationBaseline(lifetime,malformed,false,note)).toEqual({kind:'unavailable'});
    expect(notificationBaseline(lifetime,malformed,false,{id:'different',occurrence:'new'})).toEqual({kind:'absent'});
    const cached=advanceNotificationBaseline(malformed,lifetime,[],[],false);
    expect(notificationBaseline(lifetime,cached,false,note)).toEqual({kind:'unavailable'});
  });

  it('requires the same occurrence and a coherent raw ID for a decoded existing row',()=>{
    const lifetime={},collision=advanceNotificationBaseline(undefined,lifetime,[{...row,occurrence:'other'}],[note.id],true);
    expect(notificationBaseline(lifetime,collision,false,note)).toEqual({kind:'unavailable'});
    const incoherent=advanceNotificationBaseline(undefined,lifetime,[row],[],true);
    expect(notificationBaseline(lifetime,incoherent,false,note)).toEqual({kind:'unavailable'});
  });

  it('never revives old confirmed knowledge after account or vehicle A → B → A',()=>{
    const a1={},b={},a2={};
    const original=advanceNotificationBaseline(undefined,a1,[],[],true);
    expect(notificationBaseline(b,original,false,note)).toEqual({kind:'unavailable'});
    expect(notificationBaseline(a2,original,false,note)).toEqual({kind:'unavailable'});
    const returnedCache=advanceNotificationBaseline(original,a2,[],[],false);
    expect(returnedCache.confirmedRawIds).toBeNull();
    expect(notificationBaseline(a2,returnedCache,false,note)).toEqual({kind:'unavailable'});
  });

  it('refuses a listener error even with retained records, and allows the next healthy snapshot',()=>{
    const lifetime={},snapshot=advanceNotificationBaseline(undefined,lifetime,[row],[row.id],true);
    expect(notificationBaseline(lifetime,snapshot,true,note)).toEqual({kind:'unavailable'});
    expect(notificationBaseline(lifetime,snapshot,false,note)).toEqual({kind:'existing',before:row});
  });
});
