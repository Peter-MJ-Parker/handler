import type { Message } from 'discord.js';
import { concatMap, filter, from, fromEvent, map, Observable, of } from 'rxjs';
import { Err } from 'ts-results';
import type { Args } from '../..';
import { controller } from '../sern';
import Context from '../structures/context';
import type Wrapper from '../structures/wrapper';
import { fmt } from '../utilities/messageHelpers';
import * as Files from '../utilities/readFile';
import { filterCorrectModule, ignoreNonBot } from './observableHandling';
import { CommandType } from '../structures/enums';

export const onMessageCreate = (wrapper: Wrapper) => {
    const { client, defaultPrefix } = wrapper;
    if (defaultPrefix === undefined) return;

    const messageEvent$ = <Observable<Message>>fromEvent(client, 'messageCreate');

    const processMessage$ = messageEvent$.pipe(
        ignoreNonBot(defaultPrefix),
        map(message => {
            const [prefix, ...rest] = fmt(message, defaultPrefix);
            return {
                ctx: Context.wrap(message), //TODO : check for BothCommand
                args: <Args>['text', rest],
                mod:
                    Files.BothCommands.get(prefix) ??
                    Files.TextCommands.aliases.get(prefix),
            };
        }),
    );
    const ensureModuleType$ = processMessage$.pipe(
        concatMap(payload =>
            of(payload.mod).pipe(
                //SUPPORT COMMANDTYPE.BOTH
                filterCorrectModule(CommandType.Text),
                map(mod => ({ ...payload, mod })),
            ),
        ),
    );

    const processEventPlugins$ = ensureModuleType$.pipe(
        concatMap(({ ctx, args, mod }) => {
            const res = Promise.all(
                mod.onEvent?.map(ePlug => {
                    if ((ePlug.modType & mod.type) === 0) {
                        return Err.EMPTY;
                    }
                    return ePlug.execute([ctx, args], controller);
                }) ?? [],
            );
            return from(res).pipe(map(res => ({ mod, ctx, args, res })));
        }),
    );

    processEventPlugins$.subscribe(({ mod, ctx, args, res }) => {
        if (res.every(pl => pl.ok)) {
            Promise.resolve(mod.execute(ctx, args)).then(() => console.log(mod));
        } else {
            console.log(mod, 'failed');
        }
    });
};
